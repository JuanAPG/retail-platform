import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { Basket } from '../entities/basket.entity';
import { Transaction } from '../entities/transaction.entity';
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

  async buildFromTransaction(transactionId: string): Promise<Basket> {
    const transaction = await this.transactionsRepo.findOne({
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

    const basket = this.basketsRepo.create({
      transactionId: transaction.id,
      zoneId: transaction.store.zonaId,
      segmentId: null,
      date: transaction.fecha,
      totalValue: totalValue.toFixed(2),
      productCount: lines.length,
      unitsTotal: unitsTotal.toFixed(2),
      basicProductsCount,
    });

    const saved = await this.basketsRepo.save(basket);
    await this.classifyByZoneAndSegment(saved.id);
    return saved;
  }

  async classifyByZoneAndSegment(basketId: string): Promise<Basket> {
    const basket = await this.findOne(basketId);
    basket.segmentId = await this.findSegmentId(basket.zoneId);
    return this.basketsRepo.save(basket);
  }

  /**
   * Segmento vigente de una zona (RN-02: agregado por zona, nunca por
   * persona). Lectura directa de solo lectura: las tablas las escribe
   * catalog-service; aquí no se modifica ninguna clasificación.
   */
  async findSegmentId(zoneId: string): Promise<number | null> {
    const [fila] = await this.dataSource.query(
      `
      SELECT s.id AS "segmentId"
      FROM zona_clasificaciones zc
      LEFT JOIN corrida_clusters cc
            ON cc.corrida_id = zc.corrida_id AND cc.cluster_valor = zc.cluster_valor
      LEFT JOIN segmentos_ingreso s
            ON s.id = COALESCE(zc.segmento_manual_id, cc.segmento_ingreso_id)
      WHERE zc.zona_id = $1 AND zc.vigente
      LIMIT 1
      `,
      [zoneId],
    );
    return fila?.segmentId ?? null;
  }

  async findAll(filters: BasketFilterDto): Promise<Basket[]> {
    const qb = this.basketsRepo.createQueryBuilder('basket').leftJoinAndSelect('basket.zone', 'zone');
    if (filters.zoneId) qb.andWhere('basket.zoneId = :zoneId', { zoneId: filters.zoneId });
    if (filters.segmentId) qb.andWhere('basket.segmentId = :segmentId', { segmentId: filters.segmentId });
    if (filters.dateFrom) qb.andWhere('basket.date >= :dateFrom', { dateFrom: filters.dateFrom });
    if (filters.dateTo) qb.andWhere('basket.date <= :dateTo', { dateTo: filters.dateTo });
    if (filters.storeId) qb.leftJoin('basket.transaction', 'transaction').andWhere('transaction.storeId = :storeId', { storeId: filters.storeId });
    return qb.orderBy('basket.date', 'DESC').getMany();
  }

  async findOne(id: string): Promise<Basket> {
    const basket = await this.basketsRepo.findOne({ where: { id }, relations: ['zone', 'transaction'] });
    if (!basket) throw new NotFoundException(`No existe la canasta ${id}.`);
    return basket;
  }
}
