import {
  BadRequestException,
  ConflictException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
  PayloadTooLargeException,
  UnsupportedMediaTypeException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { createHash } from 'crypto';
import { DataSource, EntityManager, In, IsNull, Repository } from 'typeorm';
import { Transaction } from '../entities/transaction.entity';
import { TransactionDetail } from '../entities/transaction-detail.entity';
import { EstadoImportacion, Importacion } from '../entities/importacion.entity';
import { ImportacionFila } from '../entities/importacion-fila.entity';
import { ImportacionError } from '../entities/importacion-error.entity';
import { SesionUsuario } from '../common/auth/session.guard';
import { AuditReporter } from '../common/audit/audit-reporter.service';
import {
  CatalogClient,
  estaActivo,
  PresentacionCatalogo,
  ProductoCatalogo,
} from '../common/catalog/catalog-client.service';
import { BasketsService } from '../baskets/baskets.service';
import { Pagina } from '../common/dto/pagination.dto';
import { paginar } from '../common/helpers/pagination.helper';
import { aTransaccionRespuesta, TransaccionRespuesta } from '../common/respuestas';
import { CreateTransactionDto } from './dto/create-transaction.dto';
import { TransactionFilterDto } from './dto/transaction-filter.dto';
import { MapaColumnas, parsearCsv } from './csv.util';
import { calcularTotal } from './money.util';
import { esFechaFutura, parsearDecimal, parsearFecha } from './fecha.util';

/** Archivo que entrega `FileInterceptor` (tipo estructural: no hay @types/multer). */
export interface ArchivoSubido {
  buffer: Buffer;
  originalname: string;
  mimetype: string;
  size: number;
}

export interface CsvPreviewError {
  fila: number | null;
  columna: string | null;
  codigo: string;
  mensaje: string;
  valorRecibido: string | null;
}

export interface CsvPreviewGroup {
  folio: string;
  tienda: string;
  tiendaId: string;
  fecha: string;
  lineas: number;
  totalEstimado: number;
}

export interface CsvPreviewResult {
  importacionId: string;
  fileName: string;
  estado: string;
  filasTotales: number;
  filasValidas: number;
  filasConError: number;
  transaccionesDetectadas: number;
  grupos: CsvPreviewGroup[];
  errores: CsvPreviewError[];
}

export interface CsvImportOmitido {
  folio: string;
  tienda: string;
  tiendaId: string;
  motivo: string;
}

export interface CsvImportResult {
  importacionId: string;
  estado: string;
  filasTotales: number;
  filasValidas: number;
  filasConError: number;
  /** Líneas insertadas en ESTA llamada. */
  lineasInsertadas: number;
  /** Transacciones creadas en ESTA llamada. */
  transaccionesCreadas: number;
  canastasCreadas: number;
  /** Acumulado de todas las llamadas (lo que hay en la base). */
  transaccionesTotales: number;
  /**
   * Filas válidas que todavía no se insertaron. Si es > 0 la importación
   * NO se marca confirmada y se puede reintentar para terminarla.
   */
  filasPendientes: number;
  completa: boolean;
  omitidos: CsvImportOmitido[];
  errores: CsvPreviewError[];
}

export interface ImportacionDescartada {
  importacionId: string;
  fileName: string;
  estado: string;
  estadoPrevio: string;
}

export interface ImportacionPendiente {
  importacionId: string;
  fileName: string;
  estado: string;
  filasTotales: number;
  filasValidas: number;
  filasConError: number;
  /**
   * Filas válidas que aún no se insertaron. Si es menor que `filasValidas`,
   * esta importación quedó aplicada a medias y confirmarla de nuevo
   * retoma solo lo que falta.
   */
  filasPendientes: number;
  cargadoEn: string;
}

const MAX_ARCHIVO_BYTES = 5 * 1024 * 1024;
const MAX_ERRORES_PREVIEW = 200;

/** Lo que manda un navegador o `curl -F` para un .csv, según el sistema. */
const MIMES_CSV = new Set([
  'text/csv',
  'text/plain',
  'application/csv',
  'application/vnd.ms-excel',
  'application/octet-stream',
]);

/** Fila del CSV ya interpretada (o marcada con error). */
interface FilaValidada {
  numeroFila: number;
  folio: string | null;
  fecha: Date | null;
  fechaIso: string | null;
  tiendaId: string | null;
  tiendaNombre: string | null;
  presentacionId: string | null;
  cantidad: number | null;
  precio: number | null;
  errores: { columna: string | null; codigo: string; mensaje: string; valor: string | null }[];
}

@Injectable()
export class TransactionsService {
  private readonly logger = new Logger(TransactionsService.name);

  constructor(
    @InjectRepository(Transaction)
    private readonly transactionsRepo: Repository<Transaction>,
    @InjectRepository(TransactionDetail)
    private readonly detailsRepo: Repository<TransactionDetail>,
    @InjectRepository(Importacion)
    private readonly importacionesRepo: Repository<Importacion>,
    @InjectRepository(ImportacionFila)
    private readonly filasRepo: Repository<ImportacionFila>,
    @InjectRepository(ImportacionError)
    private readonly erroresRepo: Repository<ImportacionError>,
    private readonly dataSource: DataSource,
    private readonly basketsService: BasketsService,
    private readonly catalogos: CatalogClient,
    private readonly auditoria: AuditReporter,
  ) {}

  // --- Lectura -----------------------------------------------------

  async findAll(filters: TransactionFilterDto): Promise<Pagina<TransaccionRespuesta>> {
    const qb = this.transactionsRepo
      .createQueryBuilder('t')
      .leftJoinAndSelect('t.store', 'store')
      .leftJoinAndSelect('t.details', 'details')
      .leftJoinAndSelect('details.presentation', 'presentation')
      .leftJoinAndSelect('presentation.producto', 'producto');

    if (filters.storeId) qb.andWhere('t.storeId = :storeId', { storeId: filters.storeId });
    if (filters.dateFrom) qb.andWhere('t.fecha >= :dateFrom', { dateFrom: filters.dateFrom });
    // Día completo: `fecha` es timestamptz (mismo criterio que M07 y M09).
    if (filters.dateTo) qb.andWhere('t.fecha < CAST(:dateTo AS date) + 1', { dateTo: filters.dateTo });

    const pagina = await paginar(
      qb.orderBy('t.fecha', 'DESC').addOrderBy('t.id', 'DESC'),
      filters,
    );
    return { ...pagina, data: pagina.data.map(aTransaccionRespuesta) };
  }

  async findOne(id: string): Promise<TransaccionRespuesta> {
    return aTransaccionRespuesta(await this.buscar(id));
  }

  /** La entidad cruda, para uso interno. */
  private async buscar(id: string): Promise<Transaction> {
    const transaction = await this.transactionsRepo.findOne({
      where: { id },
      relations: ['store', 'details', 'details.presentation', 'details.presentation.producto'],
    });
    if (!transaction) {
      throw new NotFoundException(`No existe la transacción ${id}.`);
    }
    return transaction;
  }

  // --- Registro manual ----------------------------------------------

  async createManual(
    dto: CreateTransactionDto,
    usuario: SesionUsuario,
    token?: string,
    ip?: string,
  ): Promise<TransaccionRespuesta> {
    const [tiendas, productos] = await Promise.all([
      this.catalogos.listarTiendas(token),
      this.catalogos.listarProductos(token),
    ]);
    const tienda = tiendas.find((t) => t.id === dto.storeId);
    if (!tienda) {
      throw new NotFoundException(`No existe la tienda ${dto.storeId}.`);
    }
    // Una tienda dada de baja no origina ventas: `activo: false` en el
    // catálogo es una baja lógica, no un borrado, así que la tienda sigue
    // existiendo y hay que rechazarla aquí.
    if (!estaActivo(tienda)) {
      throw new BadRequestException(
        `La tienda ${tienda.nombre} está dada de baja: no puede originar ventas.`,
      );
    }

    // presentacionId → producto dueño y la presentación misma, para poder
    // validar el estatus del producto y la baja de la presentación.
    const productoPorPresentacion = new Map<string, ProductoCatalogo>();
    const presentacionPorId = new Map<string, PresentacionCatalogo>();
    for (const p of productos) {
      for (const pr of p.presentaciones ?? []) {
        productoPorPresentacion.set(pr.id, p);
        presentacionPorId.set(pr.id, pr);
      }
    }

    // La misma presentación dos veces viola UNIQUE (transaccion_id,
    // presentacion_id): se rechaza con un mensaje de negocio, igual que
    // `PRESENTACION_DUPLICADA` en el CSV, en vez de reventar en la base.
    const vistas = new Set<string>();
    for (const d of dto.details) {
      if (vistas.has(d.presentationId)) {
        throw new BadRequestException(
          `La presentación ${d.presentationId} aparece más de una vez: suma las cantidades en una sola línea.`,
        );
      }
      vistas.add(d.presentationId);

      const producto = productoPorPresentacion.get(d.presentationId);
      if (!producto) {
        throw new BadRequestException(`No existe la presentación ${d.presentationId}.`);
      }
      // Paridad con el CSV, que ya rechazaba PRODUCTO_INACTIVO.
      if (producto.estatus !== 'activo') {
        throw new BadRequestException(
          `El producto ${producto.sku} no está activo (estatus: ${producto.estatus}).`,
        );
      }
      const presentacion = presentacionPorId.get(d.presentationId);
      if (presentacion && !estaActivo(presentacion)) {
        throw new BadRequestException(
          `La presentación ${presentacion.nombre} de ${producto.sku} está dada de baja: no se puede vender.`,
        );
      }
    }

    const duplicado = await this.transactionsRepo.findOne({
      where: { storeId: dto.storeId, folio: dto.folio },
    });
    if (duplicado) {
      throw new ConflictException(
        `Ya existe la transacción con folio ${dto.folio} en ${tienda.nombre}.`,
      );
    }

    const total = calcularTotal(
      dto.details.map((d) => ({ cantidad: d.quantity, precioUnitario: d.unitPrice })),
    );

    let guardadaId: string;
    try {
      guardadaId = await this.dataSource.transaction(async (manager) => {
        const transaction = await manager.save(Transaction, {
          folio: dto.folio,
          storeId: dto.storeId,
          fecha: new Date(dto.fecha),
          total,
          canal: 'punto_venta',
          importacionId: null,
          capturadaPor: usuario.id,
        });
        await manager.save(
          TransactionDetail,
          dto.details.map((d) => ({
            transactionId: transaction.id,
            presentationId: d.presentationId,
            quantity: String(d.quantity),
            unitPrice: String(d.unitPrice),
          })),
        );

        await this.verificarTotal(manager, transaction.id, total);
        // Una transacción = una canasta (RN-03), en la MISMA transacción de
        // base de datos: si la canasta falla, la venta no queda a medias.
        await this.basketsService.buildFromTransaction(transaction.id, manager);
        return transaction.id;
      });
    } catch (error) {
      // Carrera con otro POST del mismo folio: la BD lo frena con UNIQUE
      // (tienda_id, folio) y aquí se traduce al 409 que ya devuelve el
      // chequeo previo, en vez de un 500.
      if (esViolacionUnica(error)) {
        throw new ConflictException(
          `Ya existe la transacción con folio ${dto.folio} en ${tienda.nombre}.`,
        );
      }
      throw error;
    }

    await this.auditoria.reportar({
      tabla: 'transacciones',
      registroId: guardadaId,
      accion: 'insert',
      descripcion: `Transacción manual ${dto.folio} en ${tienda.nombre}.`,
      usuarioId: usuario.id,
      rolId: usuario.rolId,
      ip,
      cambios: [
        { campo: 'folio', posterior: dto.folio },
        { campo: 'total', posterior: total },
      ],
    });

    return this.findOne(guardadaId);
  }

  // --- CSV: preview --------------------------------------------------

  async previewCsvImport(
    file: ArchivoSubido,
    usuario: SesionUsuario,
    token?: string,
  ): Promise<CsvPreviewResult> {
    if (!file?.buffer?.length) {
      throw new BadRequestException('No se recibió ningún archivo.');
    }
    if (file.size > MAX_ARCHIVO_BYTES) {
      throw new PayloadTooLargeException('El archivo supera el máximo de 5 MB.');
    }
    this.verificarTipoCsv(file);

    const { tabla, mapa } = parsearCsv(file.buffer);

    const hash = createHash('sha256').update(file.buffer).digest('hex');
    await this.verificarArchivoNuevo(hash);

    // La validación contra el catálogo va ANTES de persistir: si
    // catalog-service responde 503, no queda una cabecera con este hash
    // bloqueando el archivo para siempre (no hay endpoint que la libere).
    const validadas = await this.validarFilas(tabla.filas, mapa, token);

    const validas = validadas.filter((v) => v.errores.length === 0);
    const filasConError = validadas.length - validas.length;
    const estado: EstadoImportacion = filasConError > 0 ? 'con_errores' : 'validado';

    const { importacion, erroresEntidad } = await this.dataSource
      .transaction(async (manager) => {
        const cabecera = await manager.save(Importacion, {
          fileName: file.originalname,
          fileHash: hash,
          fileSizeBytes: String(file.size),
          storeId: null,
          estado,
          uploadedBy: usuario.id,
          confirmedBy: null,
          confirmedAt: null,
          totalRows: tabla.filas.length,
          validRows: validas.length,
          errorRows: filasConError,
          createdTransactions: 0,
        });

        await manager.save(
          ImportacionFila,
          validadas.map((v) =>
            manager.create(ImportacionFila, {
              importacionId: cabecera.id,
              rowNumber: v.numeroFila,
              folioOrigen: this.celda(tabla.filas[v.numeroFila - 2], mapa.folio),
              fechaOrigen: this.celda(tabla.filas[v.numeroFila - 2], mapa.fecha),
              tiendaOrigen: this.celda(tabla.filas[v.numeroFila - 2], mapa.tienda),
              skuOrigen: this.celda(tabla.filas[v.numeroFila - 2], mapa.sku),
              presentacionOrigen: this.celda(tabla.filas[v.numeroFila - 2], mapa.presentacion),
              cantidadOrigen: this.celda(tabla.filas[v.numeroFila - 2], mapa.cantidad),
              precioOrigen: this.celda(tabla.filas[v.numeroFila - 2], mapa.precio),
              storeId: v.tiendaId,
              presentationId: v.presentacionId,
              fecha: v.fecha,
              cantidad: v.cantidad != null ? String(v.cantidad) : null,
              unitPrice: v.precio != null ? String(v.precio) : null,
              valida: v.errores.length === 0,
              transactionId: null,
            }),
          ),
        );

        const errores = validadas.flatMap((v) =>
          v.errores.map((e) =>
            manager.create(ImportacionError, {
              importacionId: cabecera.id,
              rowNumber: v.numeroFila,
              columna: e.columna,
              codigo: e.codigo,
              mensaje: e.mensaje,
              severidad: 'error',
              valorRecibido: e.valor,
            }),
          ),
        );
        if (errores.length > 0) {
          await manager.save(ImportacionError, errores);
        }

        return { importacion: cabecera, erroresEntidad: errores };
      })
      .catch((error) => {
        // Dos previews simultáneos del mismo archivo: lo frena
        // `uq_importacion_hash_no_descartada`.
        if (esViolacionUnica(error)) {
          throw new ConflictException('Este archivo ya se está cargando en otra sesión.');
        }
        throw error;
      });

    const grupos = this.agruparPorTransaccion(validas);

    return {
      importacionId: importacion.id,
      fileName: importacion.fileName,
      estado: importacion.estado,
      filasTotales: importacion.totalRows,
      filasValidas: importacion.validRows,
      filasConError: importacion.errorRows,
      transaccionesDetectadas: grupos.length,
      grupos,
      errores: erroresEntidad.slice(0, MAX_ERRORES_PREVIEW).map((e) => ({
        fila: e.rowNumber,
        columna: e.columna,
        codigo: e.codigo,
        mensaje: e.mensaje,
        valorRecibido: e.valorRecibido,
      })),
    };
  }

  // --- CSV: confirm ---------------------------------------------------

  async confirmCsvImport(
    previewId: string,
    usuario: SesionUsuario,
    ip?: string,
  ): Promise<CsvImportResult> {
    const importacion = await this.importacionesRepo.findOne({ where: { id: previewId } });
    if (!importacion) {
      throw new NotFoundException(`No existe la importación ${previewId}.`);
    }
    if (importacion.estado === 'confirmado') {
      // Una importación marcada `confirmado` que todavía tiene filas
      // válidas sin insertar quedó inconsistente (confirmación
      // interrumpida bajo una versión anterior, que cerraba el estado
      // aunque faltaran filas). Negarse con 409 dejaría esas filas sin
      // ninguna vía de recuperación, así que se permite terminarla.
      const faltantes = await this.filasRepo.count({
        where: { importacionId: previewId, valida: true, transactionId: IsNull() },
      });
      if (faltantes === 0) {
        throw new ConflictException('Esta importación ya fue confirmada.');
      }
      this.logger.warn(
        `La importación ${previewId} está marcada confirmada pero tiene ${faltantes} ` +
          'filas válidas sin insertar: se retoma para completarla.',
      );
    }
    if (importacion.estado === 'descartado') {
      throw new ConflictException('Esta importación fue descartada y no se puede confirmar.');
    }
    if (importacion.estado === 'cargado') {
      throw new ConflictException('Esta importación aún no está validada.');
    }

    // Solo las filas que FALTAN. Una confirmación que se cayó a medias
    // (p. ej. la base se fue) deja insertadas unas y no otras; las ya
    // insertadas tienen `transaccion_id`, así que reintentar retoma donde
    // se quedó en vez de duplicarlas o de abandonarlas.
    const filas = await this.filasRepo.find({
      where: { importacionId: previewId, valida: true, transactionId: IsNull() },
      order: { rowNumber: 'ASC' },
    });
    if (filas.length === 0) {
      const yaInsertadas = await this.filasRepo.count({
        where: { importacionId: previewId, valida: true },
      });
      if (yaInsertadas > 0) {
        // Todas sus filas válidas ya están en la base: se cierra el estado
        // en vez de dejarla pendiente para siempre.
        return this.cerrarImportacion(importacion, usuario, ip, {
          creadas: 0,
          canastas: 0,
          lineas: 0,
          omitidos: [],
          pendientes: 0,
        });
      }
      throw new BadRequestException('La importación no tiene filas válidas que confirmar.');
    }

    // Reagrupa las filas válidas por (folio, tienda, fecha).
    const grupos = new Map<string, ImportacionFila[]>();
    for (const fila of filas) {
      const clave = `${fila.folioOrigen}||${fila.storeId}||${fila.fecha?.toISOString()}`;
      const lista = grupos.get(clave) ?? [];
      lista.push(fila);
      grupos.set(clave, lista);
    }

    let creadas = 0;
    let canastas = 0;
    let lineas = 0;
    const omitidos: CsvImportOmitido[] = [];

    for (const [, grupo] of grupos) {
      const primera = grupo[0];
      const folio = primera.folioOrigen ?? '(sin folio)';
      const tiendaId = primera.storeId as string;
      const tienda = primera.tiendaOrigen ?? tiendaId;

      const existe = await this.transactionsRepo.findOne({
        where: { storeId: tiendaId, folio },
      });
      if (existe) {
        // La venta ya está en la base (otra importación, captura manual o
        // una pasada anterior de esta misma). Se liga la fila del CSV a esa
        // transacción: es la trazabilidad correcta —"esta línea del archivo
        // corresponde a esa venta"— y además deja de contar como pendiente,
        // para que la importación pueda cerrarse en vez de quedar abierta
        // para siempre por un folio que nunca se va a insertar.
        await this.filasRepo.update(
          { id: In(grupo.map((f) => f.id)) },
          { transactionId: existe.id },
        );
        omitidos.push({
          folio,
          tienda,
          tiendaId,
          motivo: 'FOLIO_DUPLICADO: ya existe una transacción con este folio en la tienda.',
        });
        continue;
      }

      try {
        const total = calcularTotal(
          grupo.map((f) => ({
            cantidad: Number(f.cantidad),
            precioUnitario: Number(f.unitPrice),
          })),
        );

        // Todo el grupo —venta, líneas, canasta y trazabilidad de las filas
        // del CSV— entra o no entra junto. Antes la canasta y el update de
        // las filas corrían después del commit, así que un fallo dejaba la
        // venta insertada mientras el resumen la reportaba como omitida.
        await this.dataSource.transaction(async (manager) => {
          const transaction = await manager.save(Transaction, {
            folio,
            storeId: tiendaId,
            fecha: primera.fecha as Date,
            total,
            canal: 'importacion_csv',
            importacionId: importacion.id,
            capturadaPor: usuario.id,
          });
          await manager.save(
            TransactionDetail,
            grupo.map((f) => ({
              transactionId: transaction.id,
              presentationId: f.presentationId as string,
              quantity: String(f.cantidad),
              unitPrice: String(f.unitPrice),
            })),
          );

          await this.verificarTotal(manager, transaction.id, total);
          await this.basketsService.buildFromTransaction(transaction.id, manager);
          await manager.update(
            ImportacionFila,
            { id: In(grupo.map((f) => f.id)) },
            { transactionId: transaction.id },
          );
        });

        creadas++;
        canastas++;
        lineas += grupo.length;
      } catch (err) {
        omitidos.push({ folio, tienda, tiendaId, motivo: this.motivoOmision(err, folio) });
      }
    }

    // Cuántas filas válidas siguen sin insertar DESPUÉS de esta pasada.
    const pendientes = await this.filasRepo.count({
      where: { importacionId: previewId, valida: true, transactionId: IsNull() },
    });

    return this.cerrarImportacion(importacion, usuario, ip, {
      creadas,
      canastas,
      lineas,
      omitidos,
      pendientes,
    });
  }

  /**
   * Cierra (o deja abierta) la importación y arma el resumen.
   *
   * La marca `confirmado` SOLO si no quedó ninguna fila válida sin
   * insertar. Si quedaron pendientes —porque la base se cayó a media
   * confirmación o porque algún folio falló— el estado se conserva para
   * que un reintento pueda terminarla: marcarla `confirmado` con filas
   * varadas las dejaba sin ninguna vía de recuperación, porque el
   * siguiente intento respondía 409.
   */
  private async cerrarImportacion(
    importacion: Importacion,
    usuario: SesionUsuario,
    ip: string | undefined,
    resumen: {
      creadas: number;
      canastas: number;
      lineas: number;
      omitidos: CsvImportOmitido[];
      pendientes: number;
    },
  ): Promise<CsvImportResult> {
    const { creadas, canastas, lineas, omitidos, pendientes } = resumen;
    const completa = pendientes === 0;

    // Se CUENTA en la base, no se acumula en memoria: si una pasada se
    // interrumpió antes de guardar su contador, lo insertado en esa pasada
    // se perdía de la cuenta (quedaba 350 cuando había 400 filas reales).
    importacion.createdTransactions = await this.transactionsRepo.count({
      where: { importacionId: importacion.id },
    });
    if (completa) {
      importacion.estado = 'confirmado';
      importacion.confirmedBy = usuario.id;
      importacion.confirmedAt = new Date();
    }
    await this.importacionesRepo.save(importacion);

    const errores = await this.erroresRepo.find({
      where: { importacionId: importacion.id },
      order: { rowNumber: 'ASC' },
      take: MAX_ERRORES_PREVIEW,
    });

    // Solo se audita la confirmación (la mutación real). Si audit-service
    // no responde, la importación igual queda (best-effort).
    await this.auditoria.reportar({
      usuarioId: usuario.id,
      rolId: usuario.rolId,
      tabla: 'importaciones',
      registroId: importacion.id,
      accion: 'importacion',
      descripcion:
        `Importación CSV "${importacion.fileName}" ` +
        (completa ? 'confirmada' : 'confirmada PARCIALMENTE') +
        `: ${creadas} transacciones y ${canastas} canastas creadas en esta pasada` +
        (omitidos.length > 0 ? `, ${omitidos.length} folios omitidos` : '') +
        (completa ? '.' : `, ${pendientes} filas válidas pendientes de reintentar.`),
      ip,
      cambios: [
        { campo: 'transacciones_creadas', posterior: String(creadas) },
        { campo: 'canastas_creadas', posterior: String(canastas) },
        { campo: 'lineas_insertadas', posterior: String(lineas) },
        { campo: 'filas_rechazadas', posterior: String(importacion.errorRows) },
        { campo: 'filas_pendientes', posterior: String(pendientes) },
        { campo: 'folios_omitidos', posterior: String(omitidos.length) },
        { campo: 'estado', posterior: importacion.estado },
      ],
    });

    return {
      importacionId: importacion.id,
      estado: importacion.estado,
      filasTotales: importacion.totalRows,
      filasValidas: importacion.validRows,
      filasConError: importacion.errorRows,
      lineasInsertadas: lineas,
      transaccionesCreadas: creadas,
      canastasCreadas: canastas,
      transaccionesTotales: importacion.createdTransactions,
      filasPendientes: pendientes,
      completa,
      omitidos,
      errores: errores.map((e) => ({
        fila: e.rowNumber,
        columna: e.columna,
        codigo: e.codigo,
        mensaje: e.mensaje,
        valorRecibido: e.valorRecibido,
      })),
    };
  }

  /**
   * Descarta una importación no confirmada: libera su archivo para poder
   * volver a subirlo.
   *
   * Sin esto, un preview equivocado dejaba el `file_hash` tomado y el
   * archivo quedaba rechazado con 409 para siempre, porque `descartado`
   * era el único estado que libera el hash y ningún endpoint lo escribía.
   * Las filas y errores de staging se van por `ON DELETE CASCADE` cuando
   * se purgue la importación; aquí basta con cambiar el estado.
   */
  async discardCsvImport(
    previewId: string,
    usuario: SesionUsuario,
    ip?: string,
  ): Promise<ImportacionDescartada> {
    const importacion = await this.importacionesRepo.findOne({ where: { id: previewId } });
    if (!importacion) {
      throw new NotFoundException(`No existe la importación ${previewId}.`);
    }
    if (importacion.estado === 'confirmado') {
      throw new ConflictException(
        'Esta importación ya fue confirmada: sus transacciones están en la base y no se puede descartar.',
      );
    }
    if (importacion.estado === 'descartado') {
      throw new ConflictException('Esta importación ya estaba descartada.');
    }

    const estadoPrevio = importacion.estado;
    importacion.estado = 'descartado';
    await this.importacionesRepo.save(importacion);

    await this.auditoria.reportar({
      tabla: 'importaciones',
      registroId: importacion.id,
      accion: 'update',
      descripcion: `Importación CSV "${importacion.fileName}" descartada sin confirmar.`,
      usuarioId: usuario.id,
      rolId: usuario.rolId,
      ip,
      cambios: [{ campo: 'estado', previo: estadoPrevio, posterior: 'descartado' }],
    });

    return {
      importacionId: importacion.id,
      fileName: importacion.fileName,
      estado: importacion.estado,
      estadoPrevio,
    };
  }

  async listPendingImports(): Promise<ImportacionPendiente[]> {
    const pendientes = await this.importacionesRepo.find({
      where: { estado: In(['validado', 'con_errores']) },
      order: { uploadedAt: 'DESC' },
    });
    if (pendientes.length === 0) return [];

    // Cuántas filas válidas faltan por insertar en cada una, de una sola
    // consulta: una importación aplicada a medias tiene que distinguirse
    // de una que no se ha confirmado nunca.
    const faltantes = new Map<string, number>(
      (
        await this.filasRepo
          .createQueryBuilder('f')
          .select('f.importacionId', 'importacionId')
          .addSelect('COUNT(*)', 'pendientes')
          .where('f.importacionId IN (:...ids)', { ids: pendientes.map((i) => i.id) })
          .andWhere('f.valida = true')
          .andWhere('f.transactionId IS NULL')
          .groupBy('f.importacionId')
          .getRawMany<{ importacionId: string; pendientes: string }>()
      ).map((f) => [f.importacionId, Number(f.pendientes)]),
    );

    return pendientes.map((i) => ({
      importacionId: i.id,
      fileName: i.fileName,
      estado: i.estado,
      filasTotales: i.totalRows,
      filasValidas: i.validRows,
      filasConError: i.errorRows,
      filasPendientes: faltantes.get(i.id) ?? 0,
      cargadoEn: i.uploadedAt.toISOString(),
    }));
  }

  // --- Apoyos privados -------------------------------------------------

  private verificarTipoCsv(file: ArchivoSubido): void {
    const nombre = (file.originalname ?? '').toLowerCase();
    const mime = (file.mimetype ?? '').split(';')[0].trim().toLowerCase();
    if (!nombre.endsWith('.csv') || !MIMES_CSV.has(mime)) {
      throw new UnsupportedMediaTypeException(
        'Solo se admite un archivo .csv de texto delimitado.',
      );
    }
  }

  private async verificarArchivoNuevo(hash: string): Promise<void> {
    const duplicada = await this.importacionesRepo.findOne({ where: { fileHash: hash } });
    if (duplicada && duplicada.estado !== 'descartado') {
      throw new ConflictException(
        `Este archivo ya se cargó antes (importación ${duplicada.id}, estado ${duplicada.estado}).`,
      );
    }
  }

  /**
   * Red de seguridad de RN: `transacciones.total` tiene que ser igual a la
   * Σ de los `subtotal` que materializó Postgres. Corre dentro de la misma
   * transacción, así que una inconsistencia revierte la venta en vez de
   * quedar guardada. `money.util` ya replica el redondeo de la base; esto
   * garantiza que ninguna fila incoherente llegue a committearse.
   */
  private async verificarTotal(
    manager: EntityManager,
    transactionId: string,
    total: string,
  ): Promise<void> {
    const fila = await manager
      .createQueryBuilder(TransactionDetail, 'd')
      .select('COALESCE(SUM(d.subtotal), 0)', 'suma')
      .where('d.transactionId = :transactionId', { transactionId })
      .getRawOne<{ suma: string }>();

    const suma = Number(fila?.suma ?? 0).toFixed(2);
    if (suma !== total) {
      throw new InternalServerErrorException(
        `El total (${total}) no coincide con la suma de los subtotales (${suma}): no se guardó la transacción.`,
      );
    }
  }

  /**
   * Motivo legible para el resumen. Un `QueryFailedError` trae el texto
   * crudo de Postgres (constraint, tabla, valor): no se devuelve al
   * cliente, se registra con su stack.
   */
  private motivoOmision(error: unknown, folio: string): string {
    if (error instanceof BadRequestException || error instanceof ConflictException) {
      return String((error.getResponse() as { message?: string }).message ?? error.message);
    }
    if (esViolacionUnica(error)) {
      return 'FOLIO_DUPLICADO: ya existe una transacción con este folio en la tienda.';
    }
    this.logger.error(
      `No se pudo insertar el folio ${folio} de la importación: ${
        error instanceof Error ? error.message : String(error)
      }`,
      error instanceof Error ? error.stack : undefined,
    );
    return 'ERROR_INSERCION: no se pudo guardar esta transacción; revisa el log del servicio.';
  }

  private celda(fila: string[], indice: number): string | null {
    const valor = (fila[indice] ?? '').trim();
    return valor.length > 0 ? valor : null;
  }

  /**
   * Valida contra el catálogo REAL por HTTP (no contra copias locales).
   * Si catalog-service no responde, todo falla con 503 y no se inserta ni
   * se persiste nada.
   */
  private async validarFilas(
    filas: string[][],
    mapa: MapaColumnas,
    token?: string,
  ): Promise<FilaValidada[]> {
    const [tiendas, productos] = await Promise.all([
      this.catalogos.listarTiendas(token),
      this.catalogos.listarProductos(token),
    ]);
    const tiendaPorNombre = new Map(tiendas.map((t) => [t.nombre.trim().toLowerCase(), t]));

    const productoPorSku = new Map(productos.map((p) => [p.sku.trim().toLowerCase(), p]));
    // Se guarda la presentación completa, no solo su id: hace falta su
    // `activo` para rechazar las que están dadas de baja.
    const presentacionPorClave = new Map<string, PresentacionCatalogo>();
    for (const p of productos) {
      for (const pr of p.presentaciones ?? []) {
        presentacionPorClave.set(`${p.id}||${pr.nombre.trim().toLowerCase()}`, pr);
      }
    }

    const ahora = new Date();

    const validadas: FilaValidada[] = filas.map((fila, i) => {
      const v: FilaValidada = {
        numeroFila: i + 2, // +1 por base 1, +1 por el encabezado
        folio: this.celda(fila, mapa.folio),
        fecha: null,
        fechaIso: null,
        tiendaId: null,
        tiendaNombre: null,
        presentacionId: null,
        cantidad: null,
        precio: null,
        errores: [],
      };
      const error = (
        columna: string | null,
        codigo: string,
        mensaje: string,
        valor: string | null = null,
      ) => v.errores.push({ columna, codigo, mensaje, valor });

      if (!v.folio) {
        error('folio', 'FOLIO_VACIO', 'El folio es obligatorio: agrupa las líneas de una transacción.');
      }

      const fechaTxt = this.celda(fila, mapa.fecha);
      if (!fechaTxt) {
        error('fecha', 'FECHA_VACIA', 'La fecha es obligatoria (ISO yyyy-mm-dd).');
      } else {
        const fecha = parsearFecha(fechaTxt);
        if (!fecha) {
          error('fecha', 'FECHA_INVALIDA', 'La fecha no es válida (ISO yyyy-mm-dd).', fechaTxt);
        } else if (esFechaFutura(fecha, ahora)) {
          // Se compara el instante, no el texto: comparar cadenas dejaba
          // pasar formatos no ISO como "12/31/2099".
          error('fecha', 'FECHA_FUTURA', 'La fecha no puede ser futura.', fechaTxt);
        } else {
          v.fecha = fecha;
          v.fechaIso = fecha.toISOString();
        }
      }

      const tiendaTxt = this.celda(fila, mapa.tienda);
      if (!tiendaTxt) {
        error('tienda', 'TIENDA_VACIA', 'La tienda es obligatoria (nombre exacto).');
      } else {
        const tienda = tiendaPorNombre.get(tiendaTxt.toLowerCase());
        if (!tienda) {
          error('tienda', 'TIENDA_NO_EXISTE', `No existe la tienda "${tiendaTxt}".`, tiendaTxt);
        } else if (!estaActivo(tienda)) {
          // Baja lógica en el catálogo: la tienda existe pero no vende.
          error(
            'tienda',
            'TIENDA_INACTIVA',
            `La tienda "${tiendaTxt}" está dada de baja: no puede originar ventas.`,
            tiendaTxt,
          );
        } else {
          v.tiendaId = tienda.id;
          v.tiendaNombre = tienda.nombre;
        }
      }

      const skuTxt = this.celda(fila, mapa.sku);
      const presTxt = this.celda(fila, mapa.presentacion);
      if (!skuTxt) {
        error('sku', 'SKU_VACIO', 'El SKU es obligatorio.');
      } else {
        const producto = productoPorSku.get(skuTxt.toLowerCase());
        if (!producto) {
          error('sku', 'SKU_NO_EXISTE', `No existe el producto con SKU "${skuTxt}".`, skuTxt);
        } else if (producto.estatus !== 'activo') {
          error(
            'sku',
            'PRODUCTO_INACTIVO',
            `El producto "${skuTxt}" no está activo (estatus: ${producto.estatus}).`,
            skuTxt,
          );
        } else if (!presTxt) {
          error('presentacion', 'PRESENTACION_VACIA', 'La presentación es obligatoria.');
        } else {
          const presentacion = presentacionPorClave.get(
            `${producto.id}||${presTxt.toLowerCase()}`,
          );
          if (!presentacion) {
            error(
              'presentacion',
              'PRESENTACION_NO_EXISTE',
              `El producto "${skuTxt}" no tiene presentación "${presTxt}".`,
              presTxt,
            );
          } else if (!estaActivo(presentacion)) {
            error(
              'presentacion',
              'PRESENTACION_INACTIVA',
              `La presentación "${presTxt}" de "${skuTxt}" está dada de baja: no se puede vender.`,
              presTxt,
            );
          } else {
            v.presentacionId = presentacion.id;
          }
        }
      }

      // `parsearDecimal` exige decimal plano de hasta 2 decimales: la
      // columna es NUMERIC(_,2), así que `0.001` se redondearía a 0 y
      // violaría el CHECK al confirmar, y `1e3`/`0x10` no son cantidades.
      const cantidadTxt = this.celda(fila, mapa.cantidad);
      const cantidad = parsearDecimal(cantidadTxt);
      if (cantidad == null || cantidad <= 0) {
        error(
          'cantidad',
          'CANTIDAD_INVALIDA',
          'La cantidad debe ser un número mayor que cero, con máximo 2 decimales.',
          cantidadTxt,
        );
      } else {
        v.cantidad = cantidad;
      }

      const precioTxt = this.celda(fila, mapa.precio);
      const precio = parsearDecimal(precioTxt);
      if (precio == null || precio <= 0) {
        error(
          'precio',
          'PRECIO_INVALIDO',
          'El precio debe ser un número mayor que cero, con máximo 2 decimales.',
          precioTxt,
        );
      } else {
        v.precio = precio;
      }

      // Las columnas de staging tienen tope de longitud: si el texto no
      // cabe, es error de ESTA fila, no un 500 que anula todo el preview.
      this.verificarLongitudes(fila, mapa, error);

      return v;
    });

    // Nivel grupo: la misma presentación no puede repetirse dentro de la
    // misma transacción (UNIQUE transaccion_id + presentacion_id).
    const vistas = new Set<string>();
    for (const v of validadas) {
      if (v.errores.length > 0 || !v.folio || !v.tiendaId || !v.fechaIso || !v.presentacionId) {
        continue;
      }
      const clave = `${v.folio}||${v.tiendaId}||${v.fechaIso}||${v.presentacionId}`;
      if (vistas.has(clave)) {
        v.errores.push({
          columna: 'presentacion',
          codigo: 'PRESENTACION_DUPLICADA',
          mensaje: `La presentación ya aparece en el folio ${v.folio}: suma las cantidades en una sola línea.`,
          valor: null,
        });
      } else {
        vistas.add(clave);
      }
    }

    return validadas;
  }

  /**
   * Topes de `importacion_filas` en db/schema.sql. Se validan TODAS las
   * columnas porque el valor crudo se guarda en staging aunque la celda
   * sea inválida (`*_origen`), así que un texto largo desbordaría la
   * columna igual.
   */
  private static readonly LONGITUDES: { columna: keyof MapaColumnas; max: number }[] = [
    { columna: 'folio', max: 60 },
    { columna: 'fecha', max: 40 },
    { columna: 'tienda', max: 150 },
    { columna: 'sku', max: 60 },
    { columna: 'presentacion', max: 60 },
    { columna: 'cantidad', max: 40 },
    { columna: 'precio', max: 40 },
  ];

  private verificarLongitudes(
    fila: string[],
    mapa: MapaColumnas,
    error: (columna: string | null, codigo: string, mensaje: string, valor?: string | null) => void,
  ): void {
    for (const { columna, max } of TransactionsService.LONGITUDES) {
      const valor = this.celda(fila, mapa[columna]);
      if (valor && valor.length > max) {
        error(
          columna,
          'VALOR_DEMASIADO_LARGO',
          `La columna ${columna} admite máximo ${max} caracteres (llegaron ${valor.length}).`,
          valor.slice(0, 60),
        );
      }
    }
  }

  private agruparPorTransaccion(validas: FilaValidada[]): CsvPreviewGroup[] {
    const grupos = new Map<string, CsvPreviewGroup>();
    for (const v of validas) {
      const clave = `${v.folio}||${v.tiendaId}||${v.fechaIso}`;
      const grupo = grupos.get(clave) ?? {
        folio: v.folio as string,
        tienda: v.tiendaNombre as string,
        tiendaId: v.tiendaId as string,
        fecha: (v.fecha as Date).toISOString().slice(0, 10),
        lineas: 0,
        totalEstimado: 0,
      };
      grupo.lineas++;
      grupo.totalEstimado += (v.cantidad as number) * (v.precio as number);
      grupos.set(clave, grupo);
    }
    return [...grupos.values()].map((g) => ({
      ...g,
      totalEstimado: Math.round(g.totalEstimado * 100) / 100,
    }));
  }
}

/** Violación de UNIQUE de Postgres (SQLSTATE 23505). */
function esViolacionUnica(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === '23505'
  );
}
