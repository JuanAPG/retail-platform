import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ProveedorEntity } from '../entities/proveedor.entity';
import { MunicipioEntity } from '../entities/municipio.entity';
import { ZonaEntity } from '../entities/zona.entity';
import { TiendaEntity } from '../entities/tienda.entity';
import { CategoriaProductoEntity } from '../entities/categoria-producto.entity';
import { ProductoEntity } from '../entities/producto.entity';
import { CrearPropuestaProductoDto } from './dto/crear-propuesta-producto.dto';
import { RechazarProductoDto } from './dto/rechazar-producto.dto';

/** Valores del ENUM `estatus_producto` del esquema. */
export const ESTATUS_PRODUCTO = {
  PENDIENTE: 'pendiente_aprobacion',
  ACTIVO: 'activo',
  RECHAZADO: 'rechazado',
  INACTIVO: 'inactivo',
} as const;

const ROL_PROVEEDOR = 'Proveedor';

/** Forma de `request.user` que produce JwtStrategy.validate(). */
export interface UsuarioSolicitante {
  id: string;
  email: string;
  nombre: string;
  rol: string;
}

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

  // -------------------------------------------------------------------
  // Catálogos de referencia (solo lectura)
  // -------------------------------------------------------------------

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

  // -------------------------------------------------------------------
  // Productos: la lectura depende del PERFIL de quien pregunta
  // -------------------------------------------------------------------

  /**
   * Un perfil interno ve el catálogo completo. Un Proveedor ve
   * ÚNICAMENTE los productos de su propia empresa.
   *
   * El recorte se hace aquí, en la consulta, y no en el front: filtrar
   * en el navegador es cosmético — la respuesta HTTP seguiría trayendo
   * el catálogo de todos los proveedores y bastaría abrir la pestaña de
   * red para verlo.
   */
  async findProductos(solicitante: UsuarioSolicitante) {
    if (solicitante.rol !== ROL_PROVEEDOR) {
      return this.productosRepo.find({ order: { nombre: 'ASC' } });
    }

    const proveedor = await this.proveedorDe(solicitante);
    return this.productosRepo.find({
      where: { proveedorId: proveedor.id },
      order: { nombre: 'ASC' },
    });
  }

  /** Bandeja de revisión del Gerente de categoría. */
  findProductosPendientes() {
    return this.productosRepo.find({
      where: { estatus: ESTATUS_PRODUCTO.PENDIENTE },
      order: { createdAt: 'ASC' },
    });
  }

  /**
   * Alta propuesta por un Proveedor. Nace en 'pendiente_aprobacion' y
   * queda amarrada a la empresa del token: el proveedor no elige de
   * quién es el producto que da de alta.
   */
  async crearPropuesta(
    dto: CrearPropuestaProductoDto,
    solicitante: UsuarioSolicitante,
  ) {
    const proveedor = await this.proveedorDe(solicitante);

    if (!proveedor.activo) {
      throw new ForbiddenException(
        'Tu empresa proveedora está inactiva: un Administrador debe aprobarla antes de que puedas proponer productos.',
      );
    }

    const categoria = await this.categoriasRepo.findOne({
      where: { id: dto.categoriaId },
    });
    if (!categoria) {
      throw new BadRequestException('La categoría indicada no existe.');
    }

    const duplicado = await this.productosRepo.findOne({
      where: { sku: dto.sku },
    });
    if (duplicado) {
      throw new ConflictException(`Ya existe un producto con el SKU ${dto.sku}.`);
    }

    const producto = this.productosRepo.create({
      sku: dto.sku,
      nombre: dto.nombre,
      descripcion: dto.descripcion ?? null,
      categoriaId: dto.categoriaId,
      unidadMedida: dto.unidadMedida,
      esCanastaBasica: false,
      estatus: ESTATUS_PRODUCTO.PENDIENTE,
      proveedorId: proveedor.id,
      aprobadoPor: null,
      motivoRechazo: null,
    });

    return this.productosRepo.save(producto);
  }

  async aprobar(id: string, solicitante: UsuarioSolicitante) {
    const producto = await this.buscarPendiente(id);

    producto.estatus = ESTATUS_PRODUCTO.ACTIVO;
    producto.aprobadoPor = solicitante.id;
    producto.motivoRechazo = null;

    return this.productosRepo.save(producto);
  }

  async rechazar(
    id: string,
    dto: RechazarProductoDto,
    solicitante: UsuarioSolicitante,
  ) {
    const producto = await this.buscarPendiente(id);

    producto.estatus = ESTATUS_PRODUCTO.RECHAZADO;
    producto.aprobadoPor = solicitante.id;
    producto.motivoRechazo = dto.motivoRechazo;

    return this.productosRepo.save(producto);
  }

  // -------------------------------------------------------------------
  // Apoyo
  // -------------------------------------------------------------------

  /**
   * Resuelve la empresa proveedora del usuario autenticado.
   *
   * El vínculo es el correo: `usuarios` no tiene FK a `proveedores`
   * (así quedó el esquema), y tanto `usuarios.email` como
   * `proveedores.email` son UNIQUE, así que la correspondencia es 1 a 1.
   */
  private async proveedorDe(solicitante: UsuarioSolicitante) {
    const proveedor = await this.proveedoresRepo.findOne({
      where: { email: solicitante.email },
    });

    if (!proveedor) {
      throw new ForbiddenException(
        'Tu cuenta tiene rol Proveedor pero no está vinculada a ninguna empresa proveedora. Contacta al Administrador.',
      );
    }

    return proveedor;
  }

  private async buscarPendiente(id: string) {
    const producto = await this.productosRepo.findOne({ where: { id } });

    if (!producto) {
      throw new NotFoundException('El producto no existe.');
    }

    // Evita que dos revisores resuelvan la misma propuesta: el segundo
    // recibe un 409 en lugar de sobrescribir la decisión del primero.
    if (producto.estatus !== ESTATUS_PRODUCTO.PENDIENTE) {
      throw new ConflictException(
        `Esta propuesta ya fue resuelta (estatus actual: ${producto.estatus}).`,
      );
    }

    return producto;
  }
}
