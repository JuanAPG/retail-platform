import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ProveedorEntity } from '../entities/proveedor.entity';
import { MunicipioEntity } from '../entities/municipio.entity';
import { ZonaEntity } from '../entities/zona.entity';
import { TiendaEntity } from '../entities/tienda.entity';
import { CategoriaProductoEntity } from '../entities/categoria-producto.entity';
import { ProductoEntity } from '../entities/producto.entity';

/**
 * Todas las consultas son de solo lectura (findMany). Este servicio NO
 * expone create/update/delete: eso corresponde a los módulos de negocio
 * de cada portal (Admin, Catálogo, etc.) que se construirán después.
 * El objetivo aquí es alimentar de datos reales a las pantallas ya
 * diseñadas en Figma, usando lo que existe en data_retail.sql.
 */
@Injectable()
export class CatalogoService {
  constructor(
    @InjectRepository(ProveedorEntity)
    private readonly proveedoresRepo: Repository<ProveedorEntity>,
    @InjectRepository(MunicipioEntity)
    private readonly municipiosRepo: Repository<MunicipioEntity>,
    @InjectRepository(ZonaEntity)
    private readonly zonasRepo: Repository<ZonaEntity>,
    @InjectRepository(TiendaEntity)
    private readonly tiendasRepo: Repository<TiendaEntity>,
    @InjectRepository(CategoriaProductoEntity)
    private readonly categoriasRepo: Repository<CategoriaProductoEntity>,
    @InjectRepository(ProductoEntity)
    private readonly productosRepo: Repository<ProductoEntity>,
  ) {}

  findProveedores() {
    return this.proveedoresRepo.find({ order: { razonSocial: 'ASC' } });
  }

  findMunicipios() {
    return this.municipiosRepo.find({ order: { nombre: 'ASC' } });
  }

  findZonas() {
    return this.zonasRepo.find({ order: { nombre: 'ASC' } });
  }

  findTiendas() {
    return this.tiendasRepo.find({ order: { nombre: 'ASC' } });
  }

  findCategorias() {
    return this.categoriasRepo.find({ order: { nombre: 'ASC' } });
  }

  findProductos() {
    return this.productosRepo.find({ order: { nombre: 'ASC' } });
  }
}
