import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
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
  ) {}

  /** Llamado por TransactionsModule (Juan) justo después de crear una transacción. */
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
    const basicProductsCount = lines.filter(
      (l) => l.presentation?.producto?.esCanastaBasica,
    ).length;

    const basket = this.basketsRepo.create({
      transactionId: transaction.id,
      zoneId: transaction.store.zonaId,
      segmentId: null, // TODO(Zonas/Segmentos): sin método de resolución todavía
      date: transaction.date,
      totalValue: totalValue.toFixed(2),
      productCount: lines.length, // conteo de líneas — decisión ya tomada
      unitsTotal: unitsTotal.toFixed(2),
      basicProductsCount,
    });

    const saved = await this.basketsRepo.save(basket);

    await this.classifyByZoneAndSegment(saved.id);

    // TODO(AuditModule): AuditService.log({ action: 'basket.built', ... })
    // en cuanto M15 (Juan) exponga el módulo.

    return saved;
  }

  /**
   * Hoy solo confirma/reafirma la zona (ya resuelta en buildFromTransaction).
   * Cuando exista el método real en Zonas/Segmentos, aquí se agrega la
   * llamada para llenar segmentId — el resto del flujo no cambia.
   */
  async classifyByZoneAndSegment(basketId: string): Promise<Basket> {
    const basket = await this.findOne(basketId);
    // TODO(Zonas/Segmentos): basket.segmentId = await this.zonesService.resolveSegment(basket.zoneId)
    return this.basketsRepo.save(basket);
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
    if (!basket) {
      throw new NotFoundException(`No existe la canasta ${id}.`);
    }
    return basket;
  }
}