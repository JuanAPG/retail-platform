import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { TiendaEntity } from '../entities/tienda.entity';

@Injectable()
export class StoresService {
  constructor(
    @InjectRepository(TiendaEntity)
    private readonly tiendasRepo: Repository<TiendaEntity>,
  ) {}

  findAll() {
    return this.tiendasRepo.find({ order: { nombre: 'ASC' } });
  }
}
