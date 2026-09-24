import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, QueryFailedError, Repository } from 'typeorm';
import { ProveedorEntity } from '../entities/proveedor.entity';
import { CategoriaProductoEntity } from '../entities/categoria-producto.entity';
import { ProductoEntity } from '../entities/producto.entity';
import { ProductoPresentacionEntity } from '../entities/producto-presentacion.entity';
import { ProductoRevisionEntity } from '../entities/producto-revision.entity';
import { UnidadMedidaEntity } from '../entities/unidad-medida.entity';
import { ROL, UsuarioSolicitante } from '../common/roles';
import { CrearPropuestaProductoDto } from './dto/crear-propuesta-producto.dto';
import { RechazarProductoDto } from './dto/rechazar-producto.dto';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { CreatePresentationDto } from './dto/create-presentation.dto';

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

  findUnits() {
    return this.unidadesRepo.find({ order: { clave: 'ASC' } });
  }

  // -------------------------------------------------------------------
  // Proveedores y categorías (referencia del catálogo)
  // -------------------------------------------------------------------

  findProviders() {
    return this.proveedoresRepo.find({ order: { razonSocial: 'ASC' } });
  }

  findCategories() {
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
  async findAll(solicitante: UsuarioSolicitante) {
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
  findPending() {
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
  async createProposal(
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

  async findOne(id: string): Promise<ProductoEntity> {
    const producto = await this.productosRepo.findOne({
      where: { id },
      relations: { presentaciones: true },
    });
    if (!producto) {
      throw new NotFoundException('El producto no existe.');
    }
    return producto;
  }

  /**
   * Alta DIRECTA por Administrador/Gerente: nace 'activo' de inmediato,
   * sin pasar por la bandeja de aprobación (esa es solo para lo que
   * propone un Proveedor externo) y sin proveedor asociado.
   */
  async create(dto: CreateProductDto): Promise<ProductoEntity> {
    const categoria = await this.categoriasRepo.findOne({ where: { id: dto.categoriaId } });
    if (!categoria) {
      throw new BadRequestException('La categoría indicada no existe.');
    }

    const duplicado = await this.productosRepo.findOne({ where: { sku: dto.sku } });
    if (duplicado) {
      throw new ConflictException(`Ya existe un producto con el SKU ${dto.sku}.`);
    }

    const unidad = await this.unidadesRepo.findOne({ where: { clave: dto.unidadMedida } });
    if (!unidad) {
      throw new BadRequestException(`La unidad de medida '${dto.unidadMedida}' no existe en el catálogo.`);
    }

    return this.dataSource.transaction(async (manager) => {
      const producto = manager.create(ProductoEntity, {
        sku: dto.sku,
        nombre: dto.nombre,
        descripcion: dto.descripcion ?? null,
        categoriaId: dto.categoriaId,
        esCanastaBasica: dto.esCanastaBasica ?? false,
        estatus: ESTATUS_PRODUCTO.ACTIVO,
        proveedorId: null,
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

      return manager.findOneOrFail(ProductoEntity, {
        where: { id: guardado.id },
        relations: { presentaciones: true },
      });
    });
  }

  async update(id: string, dto: UpdateProductDto): Promise<ProductoEntity> {
    const producto = await this.findOne(id);

    if (dto.categoriaId !== undefined) {
      const categoria = await this.categoriasRepo.findOne({ where: { id: dto.categoriaId } });
      if (!categoria) {
        throw new BadRequestException('La categoría indicada no existe.');
      }
    }

    Object.assign(producto, {
      ...(dto.nombre !== undefined && { nombre: dto.nombre }),
      ...(dto.descripcion !== undefined && { descripcion: dto.descripcion }),
      ...(dto.categoriaId !== undefined && { categoriaId: dto.categoriaId }),
      ...(dto.esCanastaBasica !== undefined && { esCanastaBasica: dto.esCanastaBasica }),
    });
    await this.productosRepo.save(producto);

    return this.findOne(id);
  }

  async remove(id: string): Promise<void> {
    const producto = await this.findOne(id);

    try {
      await this.productosRepo.remove(producto);
    } catch (err) {
      // 23503 = foreign_key_violation. Borrar un producto borra en
      // cascada sus presentaciones, pero `transacciones_detalle` NO
      // tiene ON DELETE CASCADE a propósito: si alguna presentación ya
      // tiene ventas reales registradas, el borrado se rechaza aquí.
      if (err instanceof QueryFailedError && (err as unknown as { code?: string }).code === '23503') {
        throw new ConflictException(
          'No se puede eliminar: alguna de sus presentaciones tiene ventas u otros registros asociados.',
        );
      }
      throw err;
    }
  }

  // -------------------------------------------------------------------
  // Presentaciones (RF-35): precio, inventario y ventas cuelgan de aquí,
  // nunca del producto directamente.
  // -------------------------------------------------------------------

  async findPresentations(productId: string): Promise<ProductoPresentacionEntity[]> {
    await this.findOne(productId);
    return this.presentacionesRepo.find({
      where: { productoId: productId },
      order: { nombre: 'ASC' },
    });
  }

  async addPresentation(
    productId: string,
    dto: CreatePresentationDto,
  ): Promise<ProductoPresentacionEntity> {
    await this.findOne(productId);

    const unidad = await this.unidadesRepo.findOne({ where: { clave: dto.unidadMedida } });
    if (!unidad) {
      throw new BadRequestException(`La unidad de medida '${dto.unidadMedida}' no existe en el catálogo.`);
    }

    const presentacion = this.presentacionesRepo.create({
      productoId: productId,
      nombre: dto.nombre,
      contenido: String(dto.contenido),
      unidadMedidaId: unidad.id,
      codigoBarras: dto.codigoBarras ?? null,
      esPredeterminada: dto.esPredeterminada ?? false,
      activo: true,
    });
    return this.presentacionesRepo.save(presentacion);
  }

  async removePresentation(id: string): Promise<void> {
    const presentacion = await this.presentacionesRepo.findOne({ where: { id } });
    if (!presentacion) {
      throw new NotFoundException('La presentación no existe.');
    }

    try {
      await this.presentacionesRepo.remove(presentacion);
    } catch (err) {
      if (err instanceof QueryFailedError && (err as unknown as { code?: string }).code === '23503') {
        throw new ConflictException(
          'No se puede eliminar: esta presentación tiene ventas u otros registros asociados. Desactívala en vez de borrarla.',
        );
      }
      throw err;
    }
  }

  async approve(id: string, solicitante: UsuarioSolicitante) {
    return this.resolver(id, ESTATUS_PRODUCTO.ACTIVO, null, solicitante);
  }

  async reject(
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
