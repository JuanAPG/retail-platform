import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, Repository, SelectQueryBuilder } from 'typeorm';
import { Basket } from '../entities/basket.entity';
import { Transaction } from '../entities/transaction.entity';
import { Pagina } from '../common/dto/pagination.dto';
import { paginar } from '../common/helpers/pagination.helper';
import { BasketFilterDto } from './dto/basket-filter.dto';

@Injectable()
export class BasketsService {
  constructor(
    @InjectRepository(Basket)
    private readonly basketsRepo: Repository<Basket>,
    @InjectRepository(Transaction)
    private readonly transactionsRepo: Repository<Transaction>,
    private readonly dataSource: DataSource,
  ) {}

  /**
   * Construye la canasta de una transacción (RN-03: exactamente una).
   *
   * Recibe el `EntityManager` de quien la llama para correr DENTRO de la
   * misma transacción de base de datos que insertó la venta: si la canasta
   * falla, la venta se revierte con ella. Antes se construía después del
   * commit, así que un fallo dejaba la transacción persistida y sin
   * canasta, invisible para M07/M09 y para los algoritmos, y el folio ya
   * ocupado impedía reintentarla.
   */
  async buildFromTransaction(transactionId: string, manager?: EntityManager): Promise<Basket> {
    const em = manager ?? this.dataSource.manager;

    const transaction = await em.findOne(Transaction, {
      where: { id: transactionId },
      relations: ['store', 'details', 'details.presentation', 'details.presentation.producto'],
    });
    if (!transaction) {
      throw new NotFoundException(`No existe la transacción ${transactionId}.`);
    }

    const lines = transaction.details ?? [];
    const totalValue = lines.reduce((sum, l) => sum + Number(l.subtotal), 0);
    const unitsTotal = lines.reduce((sum, l) => sum + Number(l.quantity), 0);
    const basicProductsCount = lines.filter((l) => l.presentation?.producto?.esCanastaBasica).length;

    // `numero_productos` es "productos DISTINTOS", no líneas de detalle:
    // 500 ml y 1 L del mismo producto son dos presentaciones pero un solo
    // producto, y así lo documentan el Swagger y el catálogo de indicadores.
    const productCount = new Set(
      lines.map((l) => l.presentation?.productoId ?? l.presentationId),
    ).size;

    const basket = em.create(Basket, {
      transactionId: transaction.id,
      zoneId: transaction.store.zonaId,
      // Se resuelve antes de guardar para no necesitar un segundo save.
      segmentId: await this.findSegmentId(transaction.store.zonaId, em),
      date: transaction.fecha,
      totalValue: totalValue.toFixed(2),
      productCount,
      unitsTotal: unitsTotal.toFixed(2),
      basicProductsCount,
    });

    return em.save(Basket, basket);
  }

  /**
   * Reclasifica una canasta ya construida contra la clasificación vigente
   * de su zona. Se usa cuando la zona se clasificó después de la venta
   * (la canasta nació con `segmentId` nulo).
   */
  async classifyByZoneAndSegment(basketId: string): Promise<Basket> {
    const basket = await this.findOne(basketId);
    basket.segmentId = await this.findSegmentId(basket.zoneId);
    return this.basketsRepo.save(basket);
  }

  /**
   * Segmento vigente de una zona (RN-02: agregado por zona, nunca por
   * persona). Lectura de solo lectura a través de `v_zona_segmento`, que es
   * la vista que el esquema designa como fuente única: replicar su
   * `COALESCE` aquí dejaba la regla duplicada en dos lugares.
   */
  async findSegmentId(zoneId: string, manager?: EntityManager): Promise<number | null> {
    const em = manager ?? this.dataSource.manager;
    const [fila] = await em.query(
      `
      SELECT segmento_ingreso_id AS "segmentId"
      FROM v_zona_segmento
      WHERE zona_id = $1 AND vigente
      LIMIT 1
      `,
      [zoneId],
    );
    return fila?.segmentId ?? null;
  }

  /**
   * Canastas con filtros combinables (intersección: todo es AND) y
   * paginación estándar `?page&limit`.
   */
  async findAll(filters: BasketFilterDto): Promise<Pagina<Basket>> {
    const qb = this.basketsRepo
      .createQueryBuilder('basket')
      .leftJoinAndSelect('basket.zone', 'zone');

    this.aplicarFiltros(qb, filters);
    return paginar(qb.orderBy('basket.date', 'DESC').addOrderBy('basket.id', 'DESC'), filters);
  }

  private aplicarFiltros(qb: SelectQueryBuilder<Basket>, filters: BasketFilterDto): void {
    if (filters.zoneId) qb.andWhere('basket.zoneId = :zoneId', { zoneId: filters.zoneId });
    if (filters.segmentId) {
      qb.andWhere('basket.segmentId = :segmentId', { segmentId: filters.segmentId });
    }
    if (filters.dateFrom) qb.andWhere('basket.date >= :dateFrom', { dateFrom: filters.dateFrom });
    // `fecha` es timestamptz: comparar contra '2026-09-30' a secas dejaría
    // fuera todo lo vendido ese día después de medianoche. Mismo criterio
    // que M09, para que los dos endpoints vean el mismo conjunto.
    if (filters.dateTo) {
      qb.andWhere('basket.date < CAST(:dateTo AS date) + 1', { dateTo: filters.dateTo });
    }
    // La tienda no está en `canastas`: se llega por su transacción.
    if (filters.storeId) {
      qb.innerJoin('basket.transaction', 'transaction').andWhere(
        'transaction.storeId = :storeId',
        { storeId: filters.storeId },
      );
    }
    if (filters.minTotalValue != null) {
      qb.andWhere('basket.totalValue >= :minTotalValue', { minTotalValue: filters.minTotalValue });
    }
    if (filters.maxTotalValue != null) {
      qb.andWhere('basket.totalValue <= :maxTotalValue', { maxTotalValue: filters.maxTotalValue });
    }
    if (filters.minProductCount != null) {
      qb.andWhere('basket.productCount >= :minProductCount', {
        minProductCount: filters.minProductCount,
      });
    }
    if (filters.maxProductCount != null) {
      qb.andWhere('basket.productCount <= :maxProductCount', {
        maxProductCount: filters.maxProductCount,
      });
    }
    if (filters.hasBasicProducts != null) {
      qb.andWhere(
        filters.hasBasicProducts
          ? 'basket.basicProductsCount > 0'
          : 'basket.basicProductsCount = 0',
      );
    }
    // Tamaño de compra (RN-05): no es columna, se resuelve por rango
    // contra el catálogo `tamanos_compra`, igual que en `v_canastas`.
    if (filters.size) {
      qb.andWhere(
        `EXISTS (
           SELECT 1 FROM tamanos_compra tc
           WHERE tc.codigo = :size
             AND basket.valor_total >= tc.valor_min
             AND (tc.valor_max IS NULL OR basket.valor_total < tc.valor_max)
         )`,
        { size: filters.size },
      );
    }
  }

  async findOne(id: string): Promise<Basket> {
    const basket = await this.basketsRepo.findOne({
      where: { id },
      relations: ['zone', 'transaction'],
    });
    if (!basket) throw new NotFoundException(`No existe la canasta ${id}.`);
    return basket;
  }
}
