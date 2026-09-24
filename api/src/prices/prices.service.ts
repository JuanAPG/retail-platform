import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { PriceHistory } from '../entities/price-history.entity';
import { ProductoPresentacionEntity } from '../entities/producto-presentacion.entity';
import { TiendaEntity } from '../entities/tienda.entity';
import { UsuarioSolicitante } from '../common/roles';
import { CreatePriceDto } from './dto/create-price.dto';

export interface ZonePriceComparison {
  zoneId: string;
  zoneName: string;
  averagePrice: number;
  minPrice: number;
  maxPrice: number;
  storeCount: number;
}

export interface PriceComparisonResult {
  productId: string;
  zones: ZonePriceComparison[];
}

@Injectable()
export class PricesService {
  constructor(
    @InjectRepository(PriceHistory)
    private readonly pricesRepo: Repository<PriceHistory>,
    @InjectRepository(ProductoPresentacionEntity)
    private readonly presentationsRepo: Repository<ProductoPresentacionEntity>,
    @InjectRepository(TiendaEntity)
    private readonly storesRepo: Repository<TiendaEntity>,
    private readonly dataSource: DataSource,
  ) {}

  /**
   * Registra un precio nuevo para presentación+tienda. El histórico
   * nunca se sobrescribe (RN-06): si ya hay un precio vigente para esa
   * pareja, se cierra (se le pone `effectiveUntil` un día antes de la
   * nueva vigencia) dentro de la misma transacción, porque el índice
   * único `uq_precios_vigente` no permite dos precios vigentes a la vez.
   */
  async create(dto: CreatePriceDto, solicitante?: UsuarioSolicitante): Promise<PriceHistory> {
    const presentation = await this.presentationsRepo.findOne({
      where: { id: dto.presentationId },
    });
    if (!presentation) {
      throw new NotFoundException('La presentación indicada no existe.');
    }

    const store = await this.storesRepo.findOne({ where: { id: dto.storeId } });
    if (!store) {
      throw new NotFoundException('La tienda indicada no existe.');
    }

    const effectiveDate = dto.effectiveDate ?? new Date().toISOString().slice(0, 10);

    return this.dataSource.transaction(async (manager) => {
      const current = await manager.findOne(PriceHistory, {
        where: {
          presentationId: dto.presentationId,
          storeId: dto.storeId,
          vigente: true,
        },
      });

      if (current) {
        if (current.effectiveDate >= effectiveDate) {
          throw new ConflictException(
            'Ya existe un precio vigente con fecha igual o posterior a la indicada.',
          );
        }
        current.effectiveUntil = diaAnterior(effectiveDate);
        await manager.save(current);
      }

      const nuevo = manager.create(PriceHistory, {
        presentationId: dto.presentationId,
        storeId: dto.storeId,
        price: String(dto.price),
        effectiveDate,
        origen: 'interno',
        createdBy: solicitante?.id ?? null,
      });

      const guardado = await manager.save(nuevo);
      return manager.findOneOrFail(PriceHistory, { where: { id: guardado.id } });
    });
  }

  /**
   * Histórico de precios de un producto (todas sus presentaciones), o de
   * una presentación específica si se indica `presentationId`.
   */
  async findHistory(productId: string, presentationId?: string): Promise<PriceHistory[]> {
    // `leftJoinAndSelect`, no `innerJoin`: un QueryBuilder manual no
    // hidrata las relaciones `eager: true` de la entidad solo, hay que
    // pedirlas explícitamente o `presentation`/`store` llegan `undefined`
    // al frontend aunque la fila SQL sí las traiga para el filtro.
    const qb = this.pricesRepo
      .createQueryBuilder('precio')
      .leftJoinAndSelect('precio.presentation', 'presentacion')
      .leftJoinAndSelect('precio.store', 'tienda')
      .leftJoinAndSelect('tienda.zona', 'zona')
      .where('presentacion.producto_id = :productId', { productId })
      .orderBy('precio.fecha_vigencia_desde', 'DESC');

    if (presentationId) {
      qb.andWhere('precio.presentacion_id = :presentationId', { presentationId });
    }

    return qb.getMany();
  }

  /**
   * Compara el precio VIGENTE de un producto entre las zonas donde se
   * vende. La zona no vive en `precios`: se deriva de `tienda.zona_id`.
   */
  async compareAcrossZones(productId: string): Promise<PriceComparisonResult> {
    const filas = await this.pricesRepo
      .createQueryBuilder('precio')
      .innerJoin('precio.presentation', 'presentacion')
      .innerJoin('precio.store', 'tienda')
      .innerJoin('tienda.zona', 'zona')
      .select('zona.id', 'zoneId')
      .addSelect('zona.nombre', 'zoneName')
      .addSelect('AVG(precio.precio)', 'averagePrice')
      .addSelect('MIN(precio.precio)', 'minPrice')
      .addSelect('MAX(precio.precio)', 'maxPrice')
      .addSelect('COUNT(DISTINCT precio.tienda_id)', 'storeCount')
      .where('presentacion.producto_id = :productId', { productId })
      .andWhere('precio.vigente = true')
      .groupBy('zona.id')
      .addGroupBy('zona.nombre')
      .orderBy('zona.nombre', 'ASC')
      .getRawMany();

    return {
      productId,
      zones: filas.map((fila) => ({
        zoneId: fila.zoneId,
        zoneName: fila.zoneName,
        averagePrice: Number(fila.averagePrice),
        minPrice: Number(fila.minPrice),
        maxPrice: Number(fila.maxPrice),
        storeCount: Number(fila.storeCount),
      })),
    };
  }
}

function diaAnterior(fechaIso: string): string {
  const fecha = new Date(`${fechaIso}T00:00:00Z`);
  fecha.setUTCDate(fecha.getUTCDate() - 1);
  return fecha.toISOString().slice(0, 10);
}
