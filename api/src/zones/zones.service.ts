import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ZonaEntity } from '../entities/zona.entity';
import { MunicipioEntity } from '../entities/municipio.entity';

@Injectable()
export class ZonesService {
  constructor(
    @InjectRepository(ZonaEntity)
    private readonly zonasRepo: Repository<ZonaEntity>,
    @InjectRepository(MunicipioEntity)
    private readonly municipiosRepo: Repository<MunicipioEntity>,
  ) {}

  findZonas() {
    return this.zonasRepo.find({ order: { nombre: 'ASC' } });
  }

  findMunicipios() {
    return this.municipiosRepo.find({ order: { nombre: 'ASC' } });
  }
}
