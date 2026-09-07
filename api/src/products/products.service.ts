import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { ProveedorEntity } from '../entities/proveedor.entity';
import { CategoriaProductoEntity } from '../entities/categoria-producto.entity';
import { ProductoEntity } from '../entities/producto.entity';
import { ProductoPresentacionEntity } from '../entities/producto-presentacion.entity';
import { ProductoRevisionEntity } from '../entities/producto-revision.entity';
import { UnidadMedidaEntity } from '../entities/unidad-medida.entity';
import { ROL, UsuarioSolicitante } from '../common/roles';
import { CrearPropuestaProductoDto } from './dto/crear-propuesta-producto.dto';
import { RechazarProductoDto } from './dto/rechazar-producto.dto';

/** Valores del ENUM `estatus_producto` del esquema. */
export const ESTATUS_PRODUCTO = {
  PENDIENTE: 'pendiente_aprobacion',
  ACTIVO: 'activo',
  RECHAZADO: 'rechazado',
  INACTIVO: 'inactivo',
} as const;

@Injectable()
export class ProductsService {
  constructor(
    @InjectRepository(ProveedorEntity)
    private readonly proveedoresRepo: Repository<ProveedorEntity>,
    @InjectRepository(CategoriaProductoEntity)
    private readonly categoriasRepo: Repository<CategoriaProductoEntity>,
    @InjectRepository(ProductoEntity)
    private readonly productosRepo: Repository<ProductoEntity>,
    @InjectRepository(ProductoPresentacionEntity)
    private readonly presentacionesRepo: Repository<ProductoPresentacionEntity>,
    @InjectRepository(UnidadMedidaEntity)
    private readonly unidadesRepo: Repository<UnidadMedidaEntity>,
    private readonly dataSource: DataSource,
  ) {}

  findUnidadesMedida() {
    return this.unidadesRepo.find({ order: { clave: 'ASC' } });
  }

  // -------------------------------------------------------------------
  // Proveedores y categorías (referencia del catálogo)
  // -------------------------------------------------------------------

  findProveedores() {
    return this.proveedoresRepo.find({ order: { razonSocial: 'ASC' } });
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
    if (solicitante.rol !== ROL.PROVEEDOR) {
      return this.productosRepo.find({
        relations: { presentaciones: true },
        order: { nombre: 'ASC' },
      });
    }

    const proveedor = await this.proveedorDe(solicitante);
    return this.productosRepo.find({
      where: { proveedorId: proveedor.id },
      relations: { presentaciones: true },
      order: { nombre: 'ASC' },
    });
  }

  /** Bandeja de revisión del Gerente de categoría. */
  findProductosPendientes() {
    return this.productosRepo.find({
      where: { estatus: ESTATUS_PRODUCTO.PENDIENTE },
      relations: { presentaciones: true },
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

    const unidad = await this.unidadesRepo.findOne({
      where: { clave: dto.unidadMedida },
    });
    if (!unidad) {
      throw new BadRequestException(
        `La unidad de medida '${dto.unidadMedida}' no existe en el catálogo.`,
      );
    }

    // Producto y su primera presentación se crean juntos o no se crea
    // ninguno: un producto sin presentación no se puede vender ni
    // cotizar, así que dejarlo a medias sería un registro inservible.
    return this.dataSource.transaction(async (manager) => {
      const producto = manager.create(ProductoEntity, {
        sku: dto.sku,
        nombre: dto.nombre,
        descripcion: dto.descripcion ?? null,
        categoriaId: dto.categoriaId,
        esCanastaBasica: false,
        estatus: ESTATUS_PRODUCTO.PENDIENTE,
        proveedorId: proveedor.id,
      });
      const guardado = await manager.save(producto);

      const presentacion = manager.create(ProductoPresentacionEntity, {
        productoId: guardado.id,
        nombre: dto.presentacion,
        contenido: String(dto.contenido),
        unidadMedidaId: unidad.id,
        esPredeterminada: true,
        activo: true,
      });
      await manager.save(presentacion);

      return manager.findOne(ProductoEntity, {
        where: { id: guardado.id },
        relations: { presentaciones: true },
      });
    });
  }

  async aprobar(id: string, solicitante: UsuarioSolicitante) {
    return this.resolver(id, ESTATUS_PRODUCTO.ACTIVO, null, solicitante);
  }

  async rechazar(
    id: string,
    dto: RechazarProductoDto,
    solicitante: UsuarioSolicitante,
  ) {
    return this.resolver(
      id,
      ESTATUS_PRODUCTO.RECHAZADO,
      dto.motivoRechazo,
      solicitante,
    );
  }

  /**
   * Cambia el estatus del producto Y deja constancia de la decisión.
   * Las dos cosas van en la misma transacción: un producto aprobado sin
   * registro de quién lo aprobó rompe la trazabilidad que exige RF-12.
   */
  private async resolver(
    id: string,
    estatus: string,
    motivo: string | null,
    solicitante: UsuarioSolicitante,
  ) {
    const producto = await this.buscarPendiente(id);

    return this.dataSource.transaction(async (manager) => {
      producto.estatus = estatus;
      await manager.save(producto);

      await manager.save(
        manager.create(ProductoRevisionEntity, {
          productoId: producto.id,
          estatusResultante: estatus,
          revisadoPor: solicitante.id,
          motivo,
          revisadoEn: new Date(),
        }),
      );

      return manager.findOne(ProductoEntity, {
        where: { id: producto.id },
        relations: { presentaciones: true },
      });
    });
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
