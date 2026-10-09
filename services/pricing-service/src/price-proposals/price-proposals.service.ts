import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, QueryFailedError, Repository } from 'typeorm';
import { AuditReporter } from '../common/audit/audit-reporter.service';
import { SesionUsuario } from '../common/auth/session.guard';
import { hoyOperacion } from '../common/fecha';
import { NotificationsReporter } from '../common/notifications/notifications-reporter.service';
import { Pagina } from '../common/dto/pagination.dto';
import { paginar } from '../common/helpers/pagination.helper';
import { ROL } from '../common/roles';
import { ESTATUS_PROPUESTA, PriceProposal } from '../entities/price-proposal.entity';
import { PriceAlertsService } from '../price-alerts/price-alerts.service';
import { PriceDto, PricesService } from '../prices/prices.service';
import {
  ApprovePriceProposalDto,
  CreatePriceProposalDto,
  PriceProposalQueryDto,
  RejectPriceProposalDto,
} from './dto/price-proposal.dto';

/** Una propuesta con el resumen de su presentación, producto y proveedor (ver contrato). */
export interface PriceProposalDto {
  id: string;
  presentationId: string;
  supplierId: string;
  proposedPrice: string;
  purchaseUnit: string | null;
  status: string;
  rejectionReason: string | null;
  reviewedBy: string | null;
  reviewedAt: Date | null;
  createdAt: Date;
  presentation: {
    id: string;
    productoId: string;
    nombre: string;
    contenido: string;
    unidadMedida: string;
    producto: { sku: string; nombre: string };
  };
  supplier: { id: string; razonSocial: string };
}

export interface ApprovalResult {
  proposal: PriceProposalDto;
  prices: PriceDto[];
}

function codigoSql(err: unknown): string | undefined {
  return err instanceof QueryFailedError ? (err as unknown as { code?: string }).code : undefined;
}

@Injectable()
export class PriceProposalsService {
  constructor(
    @InjectRepository(PriceProposal)
    private readonly proposalsRepo: Repository<PriceProposal>,
    private readonly dataSource: DataSource,
    private readonly audit: AuditReporter,
    private readonly prices: PricesService,
    private readonly alertas: PriceAlertsService,
    private readonly notificaciones: NotificationsReporter,
  ) {}

  /**
   * Un Proveedor propone un precio para una presentación de SU producto. Nace
   * `pendiente`, amarrada a la empresa de su cuenta (el proveedor no elige a
   * nombre de quién propone).
   */
  async create(
    dto: CreatePriceProposalDto,
    solicitante: SesionUsuario,
    ip?: string,
    token?: string,
  ): Promise<PriceProposalDto> {
    const proveedor = await this.proveedorDe(solicitante);
    if (!proveedor.activo) {
      throw new ForbiddenException(
        'Tu empresa proveedora está inactiva: un Administrador debe aprobarla antes de que puedas proponer precios.',
      );
    }

    const [presentacion] = await this.dataSource.query(
      `SELECT prod.proveedor_id, prod.estatus::text AS estatus
       FROM producto_presentaciones pres JOIN productos prod ON prod.id = pres.producto_id
       WHERE pres.id = $1`,
      [dto.presentationId],
    );
    if (!presentacion) {
      throw new BadRequestException('La presentación indicada no existe.');
    }
    if (presentacion.proveedor_id !== proveedor.id) {
      throw new ForbiddenException('Solo puedes proponer precios para presentaciones de productos de tu empresa.');
    }
    if (presentacion.estatus !== 'activo') {
      throw new ConflictException('El producto aún no está activo: espera a que se apruebe antes de proponer un precio.');
    }

    // Una propuesta pendiente por presentación y proveedor, para no saturar la bandeja.
    // (Sin índice único en el esquema: dos peticiones simultáneas del mismo proveedor
    // podrían colarse; el efecto es una propuesta duplicada que quien aprueba rechaza.)
    const pendiente = await this.proposalsRepo.findOne({
      where: { presentationId: dto.presentationId, supplierId: proveedor.id, status: ESTATUS_PROPUESTA.PENDIENTE },
    });
    if (pendiente) {
      throw new ConflictException('Ya tienes una propuesta pendiente para esta presentación.');
    }

    const guardada = await this.proposalsRepo.save(
      this.proposalsRepo.create({
        presentationId: dto.presentationId,
        supplierId: proveedor.id,
        proposedPrice: String(dto.proposedPrice),
        purchaseUnit: dto.purchaseUnit ?? null,
        status: ESTATUS_PROPUESTA.PENDIENTE,
      }),
    );

    const detalle = (await this.detallar([guardada.id]))[0];
    // Auditoría y aviso (PRI-07) en paralelo: con un servicio colgado se espera un timeout, no la suma (QA-PRI53-06).
    await Promise.all([
      this.audit.reportar({
        tabla: 'precios_propuestos_proveedor',
        registroId: guardada.id,
        accion: 'insert',
        descripcion: `Propuesta de precio (${dto.proposedPrice}) para la presentación ${dto.presentationId}.`,
        cambios: [
          { campo: 'precio_propuesto', previo: null, posterior: String(dto.proposedPrice) },
          { campo: 'estatus', previo: null, posterior: ESTATUS_PROPUESTA.PENDIENTE },
        ],
        ip: ip ?? null,
      }, token),
      // El receptor fija a quién le llega según el evento.
      this.notificaciones.emitir(
        {
          eventType: 'precio.propuesto',
          relatedEntityType: 'propuesta_precio',
          relatedEntityId: guardada.id,
          title: 'Nueva propuesta de precio',
          message: `${detalle.supplier.razonSocial} propuso ${Number(dto.proposedPrice).toFixed(2)} para ${detalle.presentation.producto.nombre} (${detalle.presentation.nombre}).`,
        },
        token,
      ),
    ]);
    return detalle;
  }

  /**
   * Un perfil interno ve todas; un Proveedor, ÚNICAMENTE las de su empresa.
   * El recorte va en la consulta (no en el cliente). Con `status=pendiente` es
   * una cola de trabajo (la más antigua primero); si no, lo más reciente primero.
   */
  async findAll(solicitante: SesionUsuario, filtros: PriceProposalQueryDto): Promise<Pagina<PriceProposalDto>> {
    const qb = this.proposalsRepo.createQueryBuilder('pp');
    if (filtros.status) {
      qb.andWhere('pp.status = :status', { status: filtros.status });
    }
    if (solicitante.rol === ROL.PROVEEDOR) {
      const proveedor = await this.proveedorDe(solicitante);
      qb.andWhere('pp.supplierId = :supplierId', { supplierId: proveedor.id });
    }
    qb.orderBy('pp.createdAt', filtros.status === ESTATUS_PROPUESTA.PENDIENTE ? 'ASC' : 'DESC').addOrderBy('pp.id', 'ASC');

    const pagina = await paginar(qb, filtros);
    return { ...pagina, data: await this.detallar(pagina.data.map((p) => p.id)) };
  }

  /**
   * Aprueba: aplica `proposedPrice` a cada tienda elegida como un precio nuevo
   * (cierra el vigente, igual que `POST /prices`) y marca la propuesta
   * `aprobado`. TODO en una transacción: si una tienda falla, no se aplica nada.
   */
  async approve(
    id: string,
    dto: ApprovePriceProposalDto,
    solicitante: SesionUsuario,
    ip?: string,
    token?: string,
  ): Promise<ApprovalResult> {
    const propuesta = await this.buscarPendiente(id);
    // Se valida también al aprobar: el producto pudo desactivarse después de la propuesta (D-08).
    await this.prices.exigirProductoActivo(propuesta.presentationId);

    const existentes: { id: string }[] = await this.dataSource.query(
      'SELECT id FROM tiendas WHERE id = ANY($1::uuid[])',
      [dto.storeIds],
    );
    const faltantes = dto.storeIds.filter((s) => !existentes.some((e) => e.id === s));
    if (faltantes.length > 0) {
      throw new BadRequestException(`Estas tiendas no existen: ${faltantes.join(', ')}.`);
    }

    // Solo la fecha: un ISO con hora se normaliza a YYYY-MM-DD.
    const effectiveDate = (dto.effectiveDate ?? hoyOperacion()).slice(0, 10);

    let creados: { id: string; storeId: string; precioPrevio: string | null }[];
    try {
      creados = await this.dataSource.transaction(async (manager) => {
        // La condición `estatus = pendiente` va en el propio UPDATE: si otro revisor
        // ganó entre la lectura de arriba y aquí, no afecta ninguna fila.
        const resultado = await manager.update(
          PriceProposal,
          { id, status: ESTATUS_PROPUESTA.PENDIENTE },
          { status: ESTATUS_PROPUESTA.APROBADO, reviewedBy: solicitante.id, reviewedAt: new Date() },
        );
        if (!resultado.affected) {
          throw new ConflictException('Esta propuesta ya fue resuelta por otro revisor.');
        }

        const hechos: { id: string; storeId: string; precioPrevio: string | null }[] = [];
        for (const storeId of dto.storeIds) {
          try {
            const { id: precioId, precioPrevio } = await this.prices.registrarPrecio(manager, {
              presentationId: propuesta.presentationId,
              storeId,
              price: propuesta.proposedPrice,
              effectiveDate,
              origen: 'propuesta_proveedor_aprobada',
              createdBy: solicitante.id,
            });
            hechos.push({ id: precioId, storeId, precioPrevio });
          } catch (err) {
            if (err instanceof ConflictException) {
              throw new ConflictException(`${err.message} (tienda ${storeId}). No se aplicó ningún precio.`);
            }
            throw err;
          }
        }
        return hechos;
      });
    } catch (err) {
      // 23505 = unique_violation: otro precio vigente se registró al mismo tiempo.
      if (codigoSql(err) === '23505') {
        throw new ConflictException('Otro precio se registró al mismo tiempo para una de las tiendas. Reintenta.');
      }
      throw err;
    }

    // Después de confirmar: auditoría (nunca rompe la operación) y caché.
    // PRI-14: el precio queda con `creado_por` = quien aprueba; el proponente se rescata aquí, de la propuesta.
    const proponente = await this.usuarioDelProveedor(propuesta.supplierId);
    const [proposal] = await this.detallar([id]);
    // Todo lo de afuera va en UN Promise.all: con servicios colgados la aprobación espera un timeout y no uno por tienda
    // y por precio (QA-PRI53-06). Ninguno rompe la operación.
    await Promise.all([
      this.audit.reportar({
        tabla: 'precios_propuestos_proveedor',
        registroId: id,
        accion: 'update',
        descripcion: `Propuesta de precio aprobada (${propuesta.proposedPrice}) para ${creados.length} tienda(s).`,
        cambios: [
          { campo: 'estatus', previo: ESTATUS_PROPUESTA.PENDIENTE, posterior: ESTATUS_PROPUESTA.APROBADO },
          { campo: 'propuesto_por', previo: null, posterior: proponente },
          { campo: 'aprobado_por', previo: null, posterior: solicitante.id },
        ],
        ip: ip ?? null,
      }, token),
      ...creados.map((c) =>
        this.audit.reportar({
          tabla: 'precios',
          registroId: c.id,
          accion: 'insert',
          descripcion: `Precio registrado (${propuesta.proposedPrice}) por aprobación de la propuesta ${id}, tienda ${c.storeId}.`,
          cambios: [
            { campo: 'precio_anterior', previo: c.precioPrevio, posterior: null },
            { campo: 'precio', previo: null, posterior: propuesta.proposedPrice },
          ],
          ip: ip ?? null,
        }, token),
      ),
      this.prices.invalidarProducto(proposal.presentation.productoId),
      // PRI-07: aviso al usuario que propuso y alerta de cambio de precio por cada tienda afectada.
      this.avisarResolucion(proposal, proponente, true, null, token),
      ...creados.map((c) =>
        this.alertas.evaluar(
          { presentationId: propuesta.presentationId, storeId: c.storeId, nuevoPrecio: Number(propuesta.proposedPrice), effectiveDate, precioId: c.id },
          token,
        ),
      ),
    ]);
    return { proposal, prices: await this.prices.detallar(creados.map((c) => c.id)) };
  }

  async reject(
    id: string,
    dto: RejectPriceProposalDto,
    solicitante: SesionUsuario,
    ip?: string,
    token?: string,
  ): Promise<PriceProposalDto> {
    const pendiente = await this.buscarPendiente(id);
    const proponente = await this.usuarioDelProveedor(pendiente.supplierId);

    // Atómico: solo cambia si SIGUE pendiente (otro revisor pudo ganar en medio).
    const resultado = await this.proposalsRepo.update(
      { id, status: ESTATUS_PROPUESTA.PENDIENTE },
      {
        status: ESTATUS_PROPUESTA.RECHAZADO,
        rejectionReason: dto.rejectionReason,
        reviewedBy: solicitante.id,
        reviewedAt: new Date(),
      },
    );
    if (!resultado.affected) {
      throw new ConflictException('Esta propuesta ya fue resuelta por otro revisor.');
    }

    const rechazada = (await this.detallar([id]))[0];
    // Auditoría y aviso en paralelo: con un servicio colgado se espera un timeout, no la suma (QA-PRI53-06).
    await Promise.all([
      this.audit.reportar({
        tabla: 'precios_propuestos_proveedor',
        registroId: id,
        accion: 'update',
        descripcion: `Propuesta de precio rechazada: ${dto.rejectionReason}`,
        cambios: [
          { campo: 'estatus', previo: ESTATUS_PROPUESTA.PENDIENTE, posterior: ESTATUS_PROPUESTA.RECHAZADO },
          { campo: 'motivo_rechazo', previo: null, posterior: dto.rejectionReason },
          { campo: 'propuesto_por', previo: null, posterior: proponente },
          { campo: 'rechazado_por', previo: null, posterior: solicitante.id },
        ],
        ip: ip ?? null,
      }, token),
      this.avisarResolucion(rechazada, proponente, false, dto.rejectionReason, token),
    ]);
    return rechazada;
  }

  // -------------------------------------------------------------------
  // Apoyo
  // -------------------------------------------------------------------

  /**
   * Usuario de la cuenta del proveedor que propuso (el vínculo es el correo; `usuarios` y `proveedores` son
   * de auth-service y aquí solo se leen). `null` si la empresa no tiene cuenta.
   */
  private async usuarioDelProveedor(supplierId: string): Promise<string | null> {
    const [fila] = await this.dataSource.query(
      'SELECT u.id FROM proveedores pr JOIN usuarios u ON u.email = pr.email WHERE pr.id = $1',
      [supplierId],
    );
    return fila?.id ?? null;
  }

  /** `propuesta.resuelta`: le llega al usuario que propuso, con el motivo si se rechazó. No bloquea. */
  private async avisarResolucion(
    propuesta: PriceProposalDto,
    proponente: string | null,
    aprobada: boolean,
    motivo: string | null,
    token?: string,
  ) {
    if (!proponente) return;
    const que = `${propuesta.presentation.producto.nombre} (${propuesta.presentation.nombre}) a ${propuesta.proposedPrice}`;
    await this.notificaciones.emitir(
      {
        eventType: 'propuesta.resuelta',
        relatedEntityType: 'propuesta_precio',
        relatedEntityId: propuesta.id,
        title: aprobada ? 'Tu propuesta de precio fue aprobada' : 'Tu propuesta de precio fue rechazada',
        message: `${que}: ${aprobada ? 'aprobada' : `rechazada. Motivo: ${motivo}`}.`,
        priority: aprobada ? 'info' : 'warning',
        recipientUserId: proponente,
      },
      token,
    );
  }

  private async buscarPendiente(id: string): Promise<PriceProposal> {
    const propuesta = await this.proposalsRepo.findOne({ where: { id } });
    if (!propuesta) {
      throw new NotFoundException('La propuesta de precio no existe.');
    }
    // Evita que dos revisores resuelvan la misma propuesta.
    if (propuesta.status !== ESTATUS_PROPUESTA.PENDIENTE) {
      throw new ConflictException(`Esta propuesta ya fue resuelta (estatus actual: ${propuesta.status}).`);
    }
    return propuesta;
  }

  /**
   * Empresa proveedora de la cuenta autenticada. El vínculo es el correo:
   * `usuarios` no tiene FK a `proveedores`, y ambos correos son UNIQUE.
   * `proveedores` es de auth-service: aquí solo se lee.
   */
  private async proveedorDe(solicitante: SesionUsuario): Promise<{ id: string; activo: boolean }> {
    const [proveedor] = await this.dataSource.query('SELECT id, activo FROM proveedores WHERE email = $1', [
      solicitante.email,
    ]);
    if (!proveedor) {
      throw new ForbiddenException(
        'Tu cuenta tiene rol Proveedor pero no está vinculada a ninguna empresa proveedora. Contacta al Administrador.',
      );
    }
    return proveedor;
  }

  /** Arma la forma del contrato para los ids dados, conservando su orden. */
  private async detallar(ids: string[]): Promise<PriceProposalDto[]> {
    if (ids.length === 0) return [];
    const filas: Record<string, unknown>[] = await this.dataSource.query(
      `SELECT pp.id, pp.presentacion_id, pp.proveedor_id, pp.precio_propuesto::text AS precio,
              pp.unidad_compra, pp.estatus::text AS estatus, pp.motivo_rechazo, pp.revisado_por,
              pp.revisado_en, pp.created_at,
              pres.producto_id, pres.nombre AS pres_nombre, pres.contenido::text AS contenido,
              u.clave AS unidad, prod.sku, prod.nombre AS producto_nombre,
              pr.razon_social
       FROM precios_propuestos_proveedor pp
       JOIN producto_presentaciones pres ON pres.id = pp.presentacion_id
       JOIN productos prod ON prod.id = pres.producto_id
       JOIN unidades_medida u ON u.id = pres.unidad_medida_id
       JOIN proveedores pr ON pr.id = pp.proveedor_id
       WHERE pp.id = ANY($1::uuid[])`,
      [ids],
    );

    const porId = new Map<string, PriceProposalDto>();
    for (const f of filas) {
      porId.set(f.id as string, {
        id: f.id as string,
        presentationId: f.presentacion_id as string,
        supplierId: f.proveedor_id as string,
        proposedPrice: f.precio as string,
        purchaseUnit: (f.unidad_compra as string | null) ?? null,
        status: f.estatus as string,
        rejectionReason: (f.motivo_rechazo as string | null) ?? null,
        reviewedBy: (f.revisado_por as string | null) ?? null,
        reviewedAt: (f.revisado_en as Date | null) ?? null,
        createdAt: f.created_at as Date,
        presentation: {
          id: f.presentacion_id as string,
          productoId: f.producto_id as string,
          nombre: f.pres_nombre as string,
          contenido: f.contenido as string,
          unidadMedida: f.unidad as string,
          producto: { sku: f.sku as string, nombre: f.producto_nombre as string },
        },
        supplier: { id: f.proveedor_id as string, razonSocial: f.razon_social as string },
      });
    }
    return ids.map((id) => porId.get(id)).filter((p): p is PriceProposalDto => p !== undefined);
  }
}
