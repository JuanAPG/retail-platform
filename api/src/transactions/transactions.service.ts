import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  PayloadTooLargeException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { createHash } from 'crypto';
import { DataSource, In, Repository } from 'typeorm';
import { Transaction } from '../entities/transaction.entity';
import { TransactionDetail } from '../entities/transaction-detail.entity';
import { EstadoImportacion, Importacion } from '../entities/importacion.entity';import { ImportacionFila } from '../entities/importacion-fila.entity';
import { ImportacionError } from '../entities/importacion-error.entity';
import { TiendaEntity } from '../entities/tienda.entity';
import { ProductoPresentacionEntity } from '../entities/producto-presentacion.entity';
import { ProductoEntity } from '../entities/producto.entity';
import { UsuarioSolicitante } from '../common/roles';
import { BasketsService } from '../baskets/baskets.service';
import { CreateTransactionDto } from './dto/create-transaction.dto';
import { TransactionFilterDto } from './dto/transaction-filter.dto';
import { MapaColumnas, parsearCsv } from './csv.util';

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
  motivo: string;
}

export interface CsvImportResult {
  importacionId: string;
  estado: string;
  transaccionesCreadas: number;
  canastasCreadas: number;
  omitidos: CsvImportOmitido[];
}

const MAX_ARCHIVO_BYTES = 5 * 1024 * 1024;
const MAX_ERRORES_PREVIEW = 200;

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
    @InjectRepository(TiendaEntity)
    private readonly tiendasRepo: Repository<TiendaEntity>,
    @InjectRepository(ProductoPresentacionEntity)
    private readonly presentacionesRepo: Repository<ProductoPresentacionEntity>,
    @InjectRepository(ProductoEntity)
    private readonly productosRepo: Repository<ProductoEntity>,
    private readonly dataSource: DataSource,
    private readonly basketsService: BasketsService,
  ) {}

  // --- Lectura -----------------------------------------------------

  findAll(filters: TransactionFilterDto): Promise<Transaction[]> {
    const qb = this.transactionsRepo
      .createQueryBuilder('t')
      .leftJoinAndSelect('t.store', 'store')
      .leftJoinAndSelect('t.details', 'details')
      .leftJoinAndSelect('details.presentation', 'presentation')
      .leftJoinAndSelect('presentation.producto', 'producto');

    if (filters.storeId) qb.andWhere('t.storeId = :storeId', { storeId: filters.storeId });
    if (filters.dateFrom) qb.andWhere('t.fecha >= :dateFrom', { dateFrom: filters.dateFrom });
    if (filters.dateTo) qb.andWhere('t.fecha <= :dateTo', { dateTo: filters.dateTo });

    return qb.orderBy('t.fecha', 'DESC').getMany();
  }

  async findOne(id: string): Promise<Transaction> {
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

  async createManual(dto: CreateTransactionDto, usuario: UsuarioSolicitante): Promise<Transaction> {
    const store = await this.tiendasRepo.findOne({ where: { id: dto.storeId } });
    if (!store) {
      throw new NotFoundException(`No existe la tienda ${dto.storeId}.`);
    }

    const presentacionIds = [...new Set(dto.details.map((d) => d.presentationId))];
    const presentaciones = await this.presentacionesRepo.find({
      where: { id: In(presentacionIds) },
    });
    if (presentaciones.length !== presentacionIds.length) {
      const encontradas = new Set(presentaciones.map((p) => p.id));
      const faltante = presentacionIds.find((id) => !encontradas.has(id));
      throw new BadRequestException(`No existe la presentación ${faltante}.`);
    }

    const duplicado = await this.transactionsRepo.findOne({
      where: { storeId: dto.storeId, folio: dto.folio },
    });
    if (duplicado) {
      throw new ConflictException(
        `Ya existe la transacción con folio ${dto.folio} en ${store.nombre}.`,
      );
    }

    const total = dto.details.reduce((sum, d) => sum + d.quantity * d.unitPrice, 0);

    const guardada = await this.dataSource.transaction(async (manager) => {
      const transaction = await manager.save(Transaction, {
        folio: dto.folio,
        storeId: dto.storeId,
        fecha: new Date(dto.fecha),
        total: total.toFixed(2),
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
      return transaction;
    });

    // Una transacción = una canasta (RN-03): se construye de inmediato.
    await this.basketsService.buildFromTransaction(guardada.id);

    return this.findOne(guardada.id);
  }

  // --- CSV: preview --------------------------------------------------

  async previewCsvImport(file: ArchivoSubido, usuario: UsuarioSolicitante): Promise<CsvPreviewResult> {
    if (!file?.buffer?.length) {
      throw new BadRequestException('No se recibió ningún archivo.');
    }
    if (file.size > MAX_ARCHIVO_BYTES) {
      throw new PayloadTooLargeException('El archivo supera el máximo de 5 MB.');
    }

    const { tabla, mapa } = parsearCsv(file.buffer);

    const hash = createHash('sha256').update(file.buffer).digest('hex');
    const duplicada = await this.importacionesRepo.findOne({ where: { fileHash: hash } });
    if (duplicada && duplicada.estado !== 'descartado') {
      throw new ConflictException(
        `Este archivo ya se cargó antes (importación ${duplicada.id}, estado ${duplicada.estado}).`,
      );
    }

    const importacion = await this.importacionesRepo.save({
      fileName: file.originalname,
      fileHash: hash,
      fileSizeBytes: String(file.size),
      storeId: null,
      estado: 'cargado' as EstadoImportacion,
      uploadedBy: usuario.id,
      confirmedBy: null,
      confirmedAt: null,
      totalRows: tabla.filas.length,
      validRows: 0,
      errorRows: 0,
      createdTransactions: 0,
    });

    const validadas = await this.validarFilas(tabla.filas, mapa);

    const filasEntidad = validadas.map((v) =>
      this.filasRepo.create({
        importacionId: importacion.id,
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
    );
    await this.filasRepo.save(filasEntidad);

    const erroresEntidad = validadas.flatMap((v) =>
      v.errores.map((e) =>
        this.erroresRepo.create({
          importacionId: importacion.id,
          rowNumber: v.numeroFila,
          columna: e.columna,
          codigo: e.codigo,
          mensaje: e.mensaje,
          severidad: 'error',
          valorRecibido: e.valor,
        }),
      ),
    );
    if (erroresEntidad.length > 0) {
      await this.erroresRepo.save(erroresEntidad);
    }

    const validas = validadas.filter((v) => v.errores.length === 0);
    importacion.validRows = validas.length;
    importacion.errorRows = validadas.length - validas.length;
    importacion.estado = importacion.errorRows > 0 ? 'con_errores' : 'validado';
    await this.importacionesRepo.save(importacion);

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

  async confirmCsvImport(previewId: string, usuario: UsuarioSolicitante): Promise<CsvImportResult> {
    const importacion = await this.importacionesRepo.findOne({ where: { id: previewId } });
    if (!importacion) {
      throw new NotFoundException(`No existe la importación ${previewId}.`);
    }
    if (importacion.estado === 'confirmado') {
      throw new ConflictException('Esta importación ya fue confirmada.');
    }
    if (importacion.estado === 'descartado') {
      throw new ConflictException('Esta importación fue descartada y no se puede confirmar.');
    }
    if (importacion.estado === 'cargado') {
      throw new ConflictException('Esta importación aún no está validada.');
    }

    const filas = await this.filasRepo.find({
      where: { importacionId: previewId, valida: true },
      order: { rowNumber: 'ASC' },
    });
    if (filas.length === 0) {
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
    const omitidos: CsvImportOmitido[] = [];

    for (const [, grupo] of grupos) {
      const primera = grupo[0];
      const folio = primera.folioOrigen ?? '(sin folio)';
      const tiendaId = primera.storeId as string;

      const existe = await this.transactionsRepo.findOne({
        where: { storeId: tiendaId, folio },
      });
      if (existe) {
        omitidos.push({ folio, tienda: tiendaId, motivo: 'FOLIO_DUPLICADO: ya existe en esta tienda.' });
        continue;
      }

      try {
        const total = grupo.reduce(
          (sum, f) => sum + Number(f.cantidad) * Number(f.unitPrice),
          0,
        );

        const guardada = await this.dataSource.transaction(async (manager) => {
          // Filas válidas => fecha, tienda y presentación siempre resueltos.
          const transaction = await manager.save(Transaction, {
            folio,
            storeId: tiendaId,
            fecha: primera.fecha as Date,
            total: total.toFixed(2),
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
          return transaction;
        });

        await this.basketsService.buildFromTransaction(guardada.id);
        canastas++;

        await this.filasRepo.update(
          { id: In(grupo.map((f) => f.id)) },
          { transactionId: guardada.id },
        );
        creadas++;
      } catch (err) {
        omitidos.push({
          folio,
          tienda: tiendaId,
          motivo: err instanceof Error ? err.message : 'Error al insertar.',
        });
      }
    }

    importacion.estado = 'confirmado';
    importacion.confirmedBy = usuario.id;
    importacion.confirmedAt = new Date();
    importacion.createdTransactions = creadas;
    await this.importacionesRepo.save(importacion);

    return {
      importacionId: importacion.id,
      estado: importacion.estado,
      transaccionesCreadas: creadas,
      canastasCreadas: canastas,
      omitidos,
    };
  }

  // --- Validación de filas (privado) -----------------------------------

  private celda(fila: string[], indice: number): string | null {
    const valor = (fila[indice] ?? '').trim();
    return valor.length > 0 ? valor : null;
  }

  private async validarFilas(filas: string[][], mapa: MapaColumnas): Promise<FilaValidada[]> {
    const tiendas = await this.tiendasRepo.find();
    const tiendaPorNombre = new Map(tiendas.map((t) => [t.nombre.trim().toLowerCase(), t]));

    const productos = await this.productosRepo.find({ relations: ['presentaciones'] });
    const productoPorSku = new Map(productos.map((p) => [p.sku.trim().toLowerCase(), p]));
    const presentacionPorClave = new Map<string, string>();
    for (const p of productos) {
      for (const pr of p.presentaciones ?? []) {
        presentacionPorClave.set(`${p.id}||${pr.nombre.trim().toLowerCase()}`, pr.id);
      }
    }

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
        const fecha = new Date(fechaTxt);
        if (Number.isNaN(fecha.getTime())) {
          error('fecha', 'FECHA_INVALIDA', 'La fecha no es válida (ISO yyyy-mm-dd).', fechaTxt);
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
          const presentacionId = presentacionPorClave.get(
            `${producto.id}||${presTxt.toLowerCase()}`,
          );
          if (!presentacionId) {
            error(
              'presentacion',
              'PRESENTACION_NO_EXISTE',
              `El producto "${skuTxt}" no tiene presentación "${presTxt}".`,
              presTxt,
            );
          } else {
            v.presentacionId = presentacionId;
          }
        }
      }

      const cantidadTxt = this.celda(fila, mapa.cantidad);
      const cantidad = cantidadTxt != null ? Number(cantidadTxt) : NaN;
      if (!cantidadTxt || !Number.isFinite(cantidad) || cantidad <= 0) {
        error('cantidad', 'CANTIDAD_INVALIDA', 'La cantidad debe ser un número mayor que cero.', cantidadTxt);
      } else {
        v.cantidad = cantidad;
      }

      const precioTxt = this.celda(fila, mapa.precio);
      const precio = precioTxt != null ? Number(precioTxt) : NaN;
      if (!precioTxt || !Number.isFinite(precio) || precio <= 0) {
        error('precio', 'PRECIO_INVALIDO', 'El precio debe ser un número mayor que cero.', precioTxt);
      } else {
        v.precio = precio;
      }

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
