import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { AvisosService, ResultadoEntrega } from '../common/avisos/avisos.service';
import { correlacionActual } from '../common/correlation/correlacion';
import { LIMITE_DEFAULT, LIMITE_MAXIMO, PAGINA_DEFAULT, Pagina } from '../common/dto/pagination.dto';
import { diaLocal, esFechaValida, vigencia } from '../common/fechas';
import {
  ahorroCrudo,
  CamposPromocion,
  contenido,
  erroresDeTipo,
  esTipoComparable,
  importe,
  mensajeIncompatible,
  ordenarComparacion,
  porcentaje,
  PresentacionMedida,
  promocionalCrudo,
  regularCrudo,
  UNIDAD_BASE,
  UnidadBase,
} from './calculo';
import { CompararPromocionesDto, CrearPromocionDto, ListarPromocionesDto } from './dto';
import { Fuentes, PrecioVigente } from './fuentes';
import { PromocionFila, RepositorioPromociones } from './repositorio';

export interface Solicitante {
  id: string;
  rol: string;
}

/** `promocionResponse` (§6), con los campos en el orden del XSD. */
export interface PromocionRespuesta {
  id: string;
  name: string;
  type: string;
  productId: string;
  presentationId: string;
  storeId: string | null;
  zoneId: string | null;
  discountPct: number | null;
  packQuantity: number | null;
  packPrice: number | null;
  promoContent: number | null;
  promoUnit: string | null;
  promoPrice: number | null;
  currency: 'MXN';
  validFrom: string;
  validTo: string;
  status: string;
  validity?: string;
  proposedBy: string;
  proposedAt: string;
  resolvedBy: string | null;
  resolvedAt: string | null;
  rejectionReason: string | null;
}

const SIN_PRECIO_REGULAR = 'Sin precio vigente en pricing-service.';
const DESCUENTO_SIN_REGULAR =
  'La presentación no tiene precio vigente en esta tienda; un descuento sin precio regular no se puede calcular.';

export function aRespuesta(p: PromocionFila, hoy: string): PromocionRespuesta {
  return {
    id: p.id,
    name: p.nombre,
    type: p.tipo,
    productId: p.productoId,
    presentationId: p.presentacionId,
    storeId: p.tiendaId,
    zoneId: p.zonaId,
    discountPct: p.descuentoPct,
    packQuantity: p.paqueteCantidad,
    packPrice: p.paquetePrecio,
    promoContent: p.empaqueContenido,
    promoUnit: p.empaqueUnidad,
    promoPrice: p.empaquePrecio,
    currency: 'MXN',
    validFrom: p.vigenteDesde,
    validTo: p.vigenteHasta,
    status: p.estatus,
    // §5: en `rechazada` no sale.
    ...(p.estatus === 'rechazada' ? {} : { validity: vigencia(p.vigenteDesde, p.vigenteHasta, hoy) }),
    proposedBy: p.propuestoPor,
    proposedAt: p.propuestoEn.toISOString(),
    resolvedBy: p.resueltoPor,
    resolvedAt: p.resueltoEn ? p.resueltoEn.toISOString() : null,
    rejectionReason: p.motivoRechazo,
  };
}

function medida(p: PromocionFila): PresentacionMedida {
  return { contenido: p.presentacionContenido, unidad: p.presentacionUnidad, tipo: p.unidadTipo, factor: p.presentacionFactor };
}

function campos(p: PromocionFila): CamposPromocion {
  return {
    type: p.tipo,
    discountPct: p.descuentoPct,
    packQuantity: p.paqueteCantidad,
    packPrice: p.paquetePrecio,
    promoContent: p.empaqueContenido,
    promoFactor: p.empaqueFactor,
    promoPrice: p.empaquePrecio,
  };
}

/**
 * promotion-service (contrato docs/contratos/promotion-service.md, D-39).
 * Lee catálogo y precio regular por HTTP; escribe SOLO `promociones` y
 * `promocion_eventos`. Nunca toca precios, elasticidades ni corridas.
 */
@Injectable()
export class PromocionesService {
  private readonly logger = new Logger('promociones');
  /** Reloj inyectable para las pruebas de fechas límite. */
  ahora: () => Date = () => new Date();
  /** Entregas en vuelo (solo para que las pruebas puedan esperarlas). */
  private readonly enVuelo = new Set<Promise<void>>();

  constructor(
    private readonly repo: RepositorioPromociones,
    private readonly fuentes: Fuentes,
    private readonly avisos: AvisosService,
  ) {}

  private hoy(): string {
    return diaLocal(this.ahora());
  }

  // ============================ Proponer (§6) ============================

  async proponer(dto: CrearPromocionDto, usuario: Solicitante, token: string): Promise<PromocionRespuesta> {
    const hoy = this.hoy();
    const errores: string[] = [];
    if (Boolean(dto.storeId) === Boolean(dto.zoneId)) {
      errores.push('Indica exactamente uno de storeId o zoneId (ámbito de la promoción)');
    }
    errores.push(...erroresDeTipo(dto as unknown as Record<string, unknown>));
    const desdeValida = esFechaValida(dto.validFrom);
    const hastaValida = esFechaValida(dto.validTo);
    if (!desdeValida) errores.push('validFrom no es una fecha válida');
    if (!hastaValida) errores.push('validTo no es una fecha válida');
    if (desdeValida && dto.validFrom < hoy) errores.push(`validFrom debe ser hoy (${hoy}) o después: no hay promociones retroactivas`);
    if (desdeValida && hastaValida && dto.validTo < dto.validFrom) errores.push('validTo no puede ser anterior a validFrom');
    if (errores.length) throw new BadRequestException({ message: 'Datos inválidos.', details: errores });

    // Catálogo por HTTP, en paralelo (§6). Inexistente → 400; no activo → 409.
    const [producto, tienda, zona, unidades] = await Promise.all([
      this.fuentes.producto(dto.productId, token),
      dto.storeId ? this.fuentes.tienda(dto.storeId, token) : Promise.resolve(undefined),
      dto.zoneId ? this.fuentes.zona(dto.zoneId, token) : Promise.resolve(undefined),
      dto.type === 'tamano_empaque' ? this.fuentes.unidades(token) : Promise.resolve(null),
    ]);
    const presentacion = producto?.presentaciones?.find((x) => x.id.toLowerCase() === dto.presentationId.toLowerCase());
    const inexistentes: string[] = [];
    if (!producto) inexistentes.push('El producto no existe.');
    else if (!presentacion) inexistentes.push('La presentación no existe o no es de ese producto.');
    if (dto.storeId && tienda === null) inexistentes.push('La tienda no existe.');
    if (dto.zoneId && zona === null) inexistentes.push('La zona no existe.');
    if (inexistentes.length) throw new BadRequestException({ message: inexistentes.join(' '), details: inexistentes });

    // D-07 / D-08.
    if (producto!.estatus !== 'activo') {
      throw new ConflictException(`El producto no está activo (estatus ${producto!.estatus}): no se le pueden hacer promociones.`);
    }
    if (!presentacion!.activo) throw new ConflictException('La presentación está dada de baja: no se le pueden hacer promociones.');

    const unidadPres = presentacion!.unidadMedida;
    if (!esTipoComparable(unidadPres.tipo)) {
      throw new BadRequestException(
        `La presentación se mide en ${unidadPres.clave} (${unidadPres.tipo}): no tiene precio unitario comparable.`,
      );
    }
    let promoFactor: number | null = null;
    if (dto.type === 'tamano_empaque') {
      const unidad = unidades!.find((u) => u.clave === dto.promoUnit);
      if (!unidad) {
        throw new BadRequestException({ message: 'Datos inválidos.', details: [`promoUnit ${dto.promoUnit} no existe en el catálogo de unidades`] });
      }
      if (unidad.tipo !== unidadPres.tipo) {
        throw new BadRequestException({
          message: 'Unidades incompatibles.',
          details: [mensajeIncompatible(unidad.clave, unidad.tipo, unidadPres.clave, unidadPres.tipo)],
        });
      }
      promoFactor = Number(unidad.factorBase);
    }

    const { promocion, eventoId } = await this.repo.crear(
      {
        nombre: dto.name,
        tipo: dto.type,
        productoId: dto.productId,
        presentacionId: dto.presentationId,
        tiendaId: dto.storeId ?? null,
        zonaId: dto.zoneId ?? null,
        descuentoPct: dto.discountPct ?? null,
        paqueteCantidad: dto.packQuantity ?? null,
        paquetePrecio: dto.packPrice ?? null,
        empaqueContenido: dto.promoContent ?? null,
        empaqueUnidad: dto.promoUnit ?? null,
        empaqueFactor: promoFactor,
        empaquePrecio: dto.promoPrice ?? null,
        presentacionContenido: Number(presentacion!.contenido),
        presentacionUnidad: unidadPres.clave,
        presentacionFactor: Number(unidadPres.factorBase),
        unidadTipo: unidadPres.tipo,
        vigenteDesde: dto.validFrom,
        vigenteHasta: dto.validTo,
        propuestoPor: usuario.id,
      },
      correlacionActual() ?? null,
    );

    // §14: después de guardar, sin esperar.
    this.despachar(eventoId, token, [
      this.avisos.auditar(
        {
          tabla: 'promociones',
          registroId: promocion.id,
          accion: 'insert',
          descripcion: `Promoción propuesta (${promocion.tipo}): "${promocion.nombre}", vigencia ${promocion.vigenteDesde} a ${promocion.vigenteHasta}.`,
        },
        token,
      ),
      this.avisos.notificar(
        {
          eventType: 'promocion.propuesta',
          relatedEntityType: 'promocion',
          relatedEntityId: promocion.id,
          title: 'Promoción por aprobar',
          message: `"${promocion.nombre}" (${promocion.tipo}, del ${promocion.vigenteDesde} al ${promocion.vigenteHasta}) espera tu aprobación.`,
          priority: 'info',
        },
        token,
      ),
    ]);
    return aRespuesta(promocion, hoy);
  }

  // ============================ Consultas (§7, §8) ============================

  async listar(q: ListarPromocionesDto): Promise<Pagina<PromocionRespuesta>> {
    if (q.activeOn && !esFechaValida(q.activeOn)) {
      throw new BadRequestException({ message: 'Parámetros inválidos.', details: ['activeOn debe ser una fecha YYYY-MM-DD'] });
    }
    const page = q.page ?? PAGINA_DEFAULT;
    const limit = Math.min(q.limit ?? LIMITE_DEFAULT, LIMITE_MAXIMO);
    const { filas, total } = await this.repo.listar(q, page, limit);
    const hoy = this.hoy();
    return { data: filas.map((f) => aRespuesta(f, hoy)), total, page, limit };
  }

  async obtener(id: string): Promise<PromocionRespuesta> {
    return aRespuesta(await this.exigir(id), this.hoy());
  }

  private async exigir(id: string): Promise<PromocionFila> {
    const p = await this.repo.buscar(id);
    if (!p) throw new NotFoundException('La promoción no existe.');
    return p;
  }

  // ============================ Resolver (§9, §10) ============================

  async aprobar(id: string, usuario: Solicitante, token: string): Promise<PromocionRespuesta> {
    return this.resolver(id, 'aprobada', usuario, token, null);
  }

  async rechazar(id: string, reason: string, usuario: Solicitante, token: string): Promise<PromocionRespuesta> {
    return this.resolver(id, 'rechazada', usuario, token, reason);
  }

  private async resolver(
    id: string,
    a: 'aprobada' | 'rechazada',
    usuario: Solicitante,
    token: string,
    motivo: string | null,
  ): Promise<PromocionRespuesta> {
    const hoy = this.hoy();
    const resultado = await this.repo.resolver(id, a, usuario.id, hoy, motivo, correlacionActual() ?? null);
    if (!resultado) {
      // No pasó la transición atómica: se explica por qué.
      const actual = await this.exigir(id);
      if (actual.estatus !== 'pendiente') {
        throw new ConflictException(`La promoción ya está ${actual.estatus}; no se resuelve dos veces.`);
      }
      throw new ConflictException(`La vigencia de la promoción terminó el ${actual.vigenteHasta}; ya no se puede aprobar.`);
    }
    const { promocion, eventoId } = resultado;
    const accion = a === 'aprobada' ? 'aprobar' : 'rechazar';
    this.despachar(eventoId, token, [
      this.avisos.auditar(
        {
          tabla: 'promociones',
          registroId: promocion.id,
          accion,
          descripcion:
            a === 'aprobada'
              ? `Promoción aprobada: "${promocion.nombre}".`
              : `Promoción rechazada: "${promocion.nombre}". Motivo: ${motivo}`,
          cambios: [{ campo: 'estatus', previo: 'pendiente', posterior: a }],
        },
        token,
      ),
      this.avisos.notificar(
        {
          eventType: 'promocion.resuelta',
          relatedEntityType: 'promocion',
          relatedEntityId: promocion.id,
          recipientUserId: promocion.propuestoPor,
          title: a === 'aprobada' ? 'Promoción aprobada' : 'Promoción rechazada',
          message:
            a === 'aprobada'
              ? `Tu promoción "${promocion.nombre}" fue aprobada.`
              : `Tu promoción "${promocion.nombre}" fue rechazada. Motivo: ${motivo}`,
          priority: 'info',
        },
        token,
      ),
    ]);
    return aRespuesta(promocion, hoy);
  }

  // ============================ Precio unitario (§11) ============================

  async precioUnitario(id: string, storeId: string | undefined, token: string) {
    const p = await this.exigir(id);
    const tienda = await this.tiendaEnAmbito([p], storeId, token);
    const precio = await this.fuentes.precioVigente(p.presentacionId, tienda, token);
    const calculo = this.calcular(p, precio);
    const baseUnit: UnidadBase = UNIDAD_BASE[p.unidadTipo];

    const regular = calculo.regular
      ? {
          disponible: true,
          price: importe(calculo.regular.price),
          effectiveDate: (precio as PrecioVigente).effectiveDate,
          contentBase: contenido(calculo.regular.contentBase),
          unitPrice: importe(calculo.regular.unitPrice),
          motivo: null,
        }
      : { disponible: false, motivo: SIN_PRECIO_REGULAR };

    const base = {
      promotionId: p.id,
      type: p.tipo,
      status: p.estatus,
      productId: p.productoId,
      presentationId: p.presentacionId,
      storeId: tienda,
      baseUnit,
      currency: 'MXN' as const,
    };
    if (!calculo.promocional) {
      // Descuento sin precio regular: no disponible, sin `promotional` ni `savingsPct` (nunca 0).
      return { ...base, disponible: false, motivo: DESCUENTO_SIN_REGULAR, regular };
    }
    return {
      ...base,
      disponible: true,
      motivo: null,
      regular,
      promotional: {
        purchasePrice: importe(calculo.promocional.purchasePrice),
        items: calculo.promocional.items,
        contentBase: contenido(calculo.promocional.contentBase),
        unitPrice: importe(calculo.promocional.unitPrice),
      },
      ...(calculo.ahorro !== null ? { savingsPct: porcentaje(calculo.ahorro) } : {}),
    };
  }

  // ============================ Comparar (§12) ============================

  async comparar(q: CompararPromocionesDto, token: string) {
    const encontradas = await this.repo.buscarVarias(q.ids);
    const porId = new Map(encontradas.map((p) => [p.id.toLowerCase(), p]));
    const faltan = q.ids.filter((id) => !porId.has(id));
    if (faltan.length) throw new NotFoundException(`No existen las promociones: ${faltan.join(', ')}.`);
    const promos = q.ids.map((id) => porId.get(id) as PromocionFila);

    if (new Set(promos.map((p) => p.productoId)).size > 1) {
      throw new BadRequestException('Las promociones son de productos distintos: solo se comparan promociones del mismo producto.');
    }
    const tipos = [...new Map(promos.map((p) => [p.unidadTipo, p])).values()];
    if (tipos.length > 1) {
      const [a, b] = tipos;
      throw new BadRequestException({
        message: 'Unidades incompatibles.',
        details: [
          `Las presentaciones mezclan ${UNIDAD_BASE[a.unidadTipo]} (${a.unidadTipo}) y ${UNIDAD_BASE[b.unidadTipo]} (${b.unidadTipo}); no se comparan.`,
        ],
      });
    }
    const tienda = await this.tiendaEnAmbito(promos, q.storeId, token);

    // Un precio regular por presentación distinta (D-06: nunca se promedian).
    const presentaciones = [...new Set(promos.map((p) => p.presentacionId))];
    const precios = new Map(
      await Promise.all(
        presentaciones.map(async (id) => [id, await this.fuentes.precioVigente(id, tienda, token)] as const),
      ),
    );

    const filas = promos.map((p) => {
      const calculo = this.calcular(p, precios.get(p.presentacionId) ?? null);
      return {
        promotionId: p.id,
        type: p.tipo,
        presentationId: p.presentacionId,
        status: p.estatus,
        disponible: calculo.promocional !== null,
        unitPrice: calculo.promocional?.unitPrice ?? null,
        regularUnitPrice: calculo.regular?.unitPrice ?? null,
        savingsPct: calculo.ahorro,
        motivo: calculo.promocional ? null : DESCUENTO_SIN_REGULAR,
      };
    });

    return {
      productId: promos[0].productoId,
      storeId: tienda,
      baseUnit: UNIDAD_BASE[promos[0].unidadTipo],
      currency: 'MXN' as const,
      // Se ordena con los valores SIN redondear y se redondea al final (§3).
      data: ordenarComparacion(filas).map((f) => ({
        promotionId: f.promotionId,
        type: f.type,
        presentationId: f.presentationId,
        status: f.status,
        disponible: f.disponible,
        ...(f.unitPrice !== null ? { unitPrice: importe(f.unitPrice) } : {}),
        ...(f.regularUnitPrice !== null ? { regularUnitPrice: importe(f.regularUnitPrice) } : {}),
        ...(f.savingsPct !== null ? { savingsPct: porcentaje(f.savingsPct) } : {}),
        ...(f.motivo ? { motivo: f.motivo } : {}),
      })),
    };
  }

  // ============================ Comunes ============================

  /** Regular, promocional y ahorro SIN redondear (§4). */
  private calcular(p: PromocionFila, precio: PrecioVigente | null) {
    const m = medida(p);
    const regular = precio ? regularCrudo(precio.price, m) : null;
    const promocional = promocionalCrudo(campos(p), m, precio ? precio.price : null);
    const ahorro = regular && promocional ? ahorroCrudo(regular.unitPrice, promocional.unitPrice) : null;
    return { regular, promocional, ahorro };
  }

  /**
   * La tienda en la que se calcula (§11): por tienda, la suya (o la misma que
   * se pidió); por zona, `storeId` obligatorio y debe ser una tienda ACTIVA de
   * esa zona. Fuera del ámbito → 400.
   */
  private async tiendaEnAmbito(promos: PromocionFila[], storeId: string | undefined, token: string): Promise<string> {
    const porTienda = promos.filter((p) => p.tiendaId);
    const porZona = promos.filter((p) => p.zonaId);
    if (!storeId) {
      if (porZona.length) throw new BadRequestException('storeId es obligatorio para una promoción por zona.');
      const unica = new Set(porTienda.map((p) => p.tiendaId));
      if (unica.size > 1) throw new BadRequestException('storeId es obligatorio: las promociones son de tiendas distintas.');
      return porTienda[0].tiendaId as string;
    }
    const tienda = storeId.toLowerCase();
    const ajena = porTienda.find((p) => (p.tiendaId as string).toLowerCase() !== tienda);
    if (ajena) throw new BadRequestException(`storeId fuera del ámbito: la promoción ${ajena.id} es de otra tienda.`);
    if (porZona.length) {
      const datos = await this.fuentes.tienda(storeId, token);
      if (!datos) throw new BadRequestException('La tienda no existe.');
      const fuera = porZona.find((p) => !datos.activo || datos.zonaId?.toLowerCase() !== (p.zonaId as string).toLowerCase());
      if (fuera) {
        throw new BadRequestException(`storeId fuera del ámbito: no es una tienda activa de la zona de la promoción ${fuera.id}.`);
      }
    }
    return storeId;
  }

  /** §14: guarda en `promocion_eventos` cómo terminó cada entrega. No bloquea ni lanza. */
  private despachar(eventoId: string, _token: string, entregas: [Promise<ResultadoEntrega>, Promise<ResultadoEntrega>]): void {
    const tarea = (async () => {
      const [auditoria, aviso] = await Promise.all(entregas);
      await this.repo.marcarEntrega(eventoId, auditoria, aviso);
    })().catch((e) => this.logger.warn(`No se pudo guardar el estado de entrega del evento ${eventoId}: ${String(e)}`));
    this.enVuelo.add(tarea);
    void tarea.finally(() => this.enVuelo.delete(tarea));
  }

  /** Para las pruebas: espera a que terminen las entregas en vuelo. */
  async esperarEntregas(): Promise<void> {
    await Promise.all([...this.enVuelo]);
  }
}
