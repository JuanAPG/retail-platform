import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, QueryFailedError, Repository } from 'typeorm';
import { SesionUsuario } from '../common/auth/session.guard';
import { Pagina } from '../common/dto/pagination.dto';
import { paginar } from '../common/helpers/pagination.helper';
import { ROL } from '../common/roles';
import { CategoriaProductoEntity } from '../entities/categoria-producto.entity';
import { ProductoEntity } from '../entities/producto.entity';
import { ProductoPresentacionEntity } from '../entities/producto-presentacion.entity';
import { ProductoRevisionEntity } from '../entities/producto-revision.entity';
import { ProveedorEntity } from '../entities/proveedor.entity';
import { UnidadMedidaEntity } from '../entities/unidad-medida.entity';
import { CrearPropuestaProductoDto } from './dto/crear-propuesta-producto.dto';
import { CreatePresentationDto } from './dto/create-presentation.dto';
import { CreateProductDto } from './dto/create-product.dto';
import { ProductFilterDto } from './dto/product-filter.dto';
import { RechazarProductoDto } from './dto/rechazar-producto.dto';
import { UpdateProductDto } from './dto/update-product.dto';

/** Valores del ENUM `estatus_producto` del esquema. */
export const ESTATUS_PRODUCTO = {
  PENDIENTE: 'pendiente_aprobacion',
  ACTIVO: 'activo',
  RECHAZADO: 'rechazado',
  INACTIVO: 'inactivo',
} as const;

function codigoSql(err: unknown): string | undefined {
  return err instanceof QueryFailedError ? (err as unknown as { code?: string }).code : undefined;
}

// TODO(audit): reportar altas, cambios, borrados y resoluciones a auditoría
// cuando se acuerde con audit-service (pendiente en el contrato).
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

  // -------------------------------------------------------------------
  // Catálogos de referencia
  // -------------------------------------------------------------------

  /** Catálogo chico e inmutable: arreglo plano, sin paginar. */
  findUnits() {
    return this.unidadesRepo.find({ order: { clave: 'ASC' } });
  }

  /** Catálogo chico e inmutable: arreglo plano, sin paginar. */
  findCategories() {
    return this.categoriasRepo.find({ order: { nombre: 'ASC' } });
  }

  /** Padrón de empresas proveedoras: paginado, por razón social. */
  findProviders(filtros: ProductFilterDto): Promise<Pagina<ProveedorEntity>> {
    const qb = this.proveedoresRepo
      .createQueryBuilder('p')
      .orderBy('p.razonSocial', 'ASC')
      .addOrderBy('p.id', 'ASC');
    return paginar(qb, filtros);
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
  async findAll(solicitante: SesionUsuario, filtros: ProductFilterDto): Promise<Pagina<ProductoEntity>> {
    const qb = this.consultaProductos().orderBy('p.nombre', 'ASC').addOrderBy('p.id', 'ASC');

    if (solicitante.rol === ROL.PROVEEDOR) {
      const proveedor = await this.proveedorDe(solicitante);
      qb.where('p.proveedorId = :proveedorId', { proveedorId: proveedor.id });
    }
    return paginar(qb, filtros);
  }

  /** Bandeja de revisión del Gerente de categoría: una cola, la más antigua primero. */
  findPending(filtros: ProductFilterDto): Promise<Pagina<ProductoEntity>> {
    const qb = this.consultaProductos()
      .where('p.estatus = :estatus', { estatus: ESTATUS_PRODUCTO.PENDIENTE })
      .orderBy('p.createdAt', 'ASC')
      .addOrderBy('p.id', 'ASC');
    return paginar(qb, filtros);
  }

  /**
   * Alta propuesta por un Proveedor. Nace en 'pendiente_aprobacion' y
   * queda amarrada a la empresa del token: el proveedor no elige de
   * quién es el producto que da de alta, ni si es canasta básica (RN-04).
   */
  async createProposal(dto: CrearPropuestaProductoDto, solicitante: SesionUsuario): Promise<ProductoEntity> {
    const proveedor = await this.proveedorDe(solicitante);
    if (!proveedor.activo) {
      throw new ForbiddenException(
        'Tu empresa proveedora está inactiva: un Administrador debe aprobarla antes de que puedas proponer productos.',
      );
    }

    await this.exigirCategoria(dto.categoriaId);
    await this.rechazarSkuRepetido(dto.sku);
    const unidad = await this.exigirUnidad(dto.unidadMedida);

    return this.crearConPresentacion(
      {
        sku: dto.sku,
        nombre: dto.nombre,
        descripcion: dto.descripcion ?? null,
        categoriaId: dto.categoriaId,
        esCanastaBasica: false,
        estatus: ESTATUS_PRODUCTO.PENDIENTE,
        proveedorId: proveedor.id,
      },
      { nombre: dto.presentacion, contenido: dto.contenido, unidadMedidaId: unidad.id },
    );
  }

  approve(id: string, solicitante: SesionUsuario): Promise<ProductoEntity> {
    return this.resolver(id, ESTATUS_PRODUCTO.ACTIVO, null, solicitante);
  }

  reject(id: string, dto: RechazarProductoDto, solicitante: SesionUsuario): Promise<ProductoEntity> {
    return this.resolver(id, ESTATUS_PRODUCTO.RECHAZADO, dto.motivoRechazo, solicitante);
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
    await this.exigirCategoria(dto.categoriaId);
    await this.rechazarSkuRepetido(dto.sku);
    const unidad = await this.exigirUnidad(dto.unidadMedida);

    return this.crearConPresentacion(
      {
        sku: dto.sku,
        nombre: dto.nombre,
        descripcion: dto.descripcion ?? null,
        categoriaId: dto.categoriaId,
        esCanastaBasica: dto.esCanastaBasica ?? false,
        estatus: ESTATUS_PRODUCTO.ACTIVO,
        proveedorId: null,
      },
      { nombre: dto.presentacion, contenido: dto.contenido, unidadMedidaId: unidad.id },
    );
  }

  async update(id: string, dto: UpdateProductDto): Promise<ProductoEntity> {
    await this.findOne(id);
    if (dto.categoriaId !== undefined) await this.exigirCategoria(dto.categoriaId);

    // Por columnas, no `save(producto)`: con la categoría (relación eager)
    // ya cargada, TypeORM ignoraría el nuevo `categoriaId`.
    const cambios = {
      ...(dto.nombre !== undefined && { nombre: dto.nombre }),
      ...(dto.descripcion !== undefined && { descripcion: dto.descripcion }),
      ...(dto.categoriaId !== undefined && { categoriaId: dto.categoriaId }),
      ...(dto.esCanastaBasica !== undefined && { esCanastaBasica: dto.esCanastaBasica }),
    };
    if (Object.keys(cambios).length > 0) {
      await this.productosRepo.update({ id }, cambios);
    }
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
      if (codigoSql(err) === '23503') {
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

  async addPresentation(productId: string, dto: CreatePresentationDto): Promise<ProductoPresentacionEntity> {
    await this.findOne(productId);
    const unidad = await this.exigirUnidad(dto.unidadMedida);

    const presentacion = this.presentacionesRepo.create({
      productoId: productId,
      nombre: dto.nombre,
      contenido: String(dto.contenido),
      unidadMedidaId: unidad.id,
      codigoBarras: dto.codigoBarras ?? null,
      esPredeterminada: dto.esPredeterminada ?? false,
      activo: true,
    });
    try {
      const guardada = await this.presentacionesRepo.save(presentacion);
      return this.presentacionesRepo.findOneOrFail({ where: { id: guardada.id } });
    } catch (err) {
      // 23505 = unique_violation. `uq_presentacion_predeterminada` permite
      // una sola presentación predeterminada por producto.
      if (codigoSql(err) === '23505') {
        throw new ConflictException(
          dto.esPredeterminada
            ? 'Este producto ya tiene una presentación predeterminada.'
            : 'Ya existe una presentación con esos datos (código de barras repetido).',
        );
      }
      throw err;
    }
  }

  async removePresentation(id: string): Promise<void> {
    const presentacion = await this.presentacionesRepo.findOne({ where: { id } });
    if (!presentacion) {
      throw new NotFoundException('La presentación no existe.');
    }
    try {
      await this.presentacionesRepo.remove(presentacion);
    } catch (err) {
      if (codigoSql(err) === '23503') {
        throw new ConflictException(
          'No se puede eliminar: esta presentación tiene ventas u otros registros asociados. Desactívala en vez de borrarla.',
        );
      }
      throw err;
    }
  }

  // -------------------------------------------------------------------
  // Apoyo
  // -------------------------------------------------------------------

  /**
   * Cambia el estatus del producto Y deja constancia de la decisión.
   * Las dos cosas van en la misma transacción: un producto aprobado sin
   * registro de quién lo aprobó rompe la trazabilidad que exige RF-12.
   */
  private async resolver(
    id: string,
    estatus: string,
    motivo: string | null,
    solicitante: SesionUsuario,
  ): Promise<ProductoEntity> {
    const producto = await this.productosRepo.findOne({ where: { id } });
    if (!producto) {
      throw new NotFoundException('El producto no existe.');
    }
    // Evita que dos revisores resuelvan la misma propuesta: el segundo
    // recibe un 409 en lugar de sobrescribir la decisión del primero.
    if (producto.estatus !== ESTATUS_PRODUCTO.PENDIENTE) {
      throw new ConflictException(`Esta propuesta ya fue resuelta (estatus actual: ${producto.estatus}).`);
    }

    return this.dataSource.transaction(async (manager) => {
      // La condición `estatus = pendiente` va en el propio UPDATE: si otro
      // revisor ganó entre la lectura de arriba y aquí, no afecta ninguna fila.
      const resultado = await manager.update(
        ProductoEntity,
        { id, estatus: ESTATUS_PRODUCTO.PENDIENTE },
        { estatus },
      );
      if (!resultado.affected) {
        throw new ConflictException('Esta propuesta ya fue resuelta por otro revisor.');
      }

      await manager.save(
        manager.create(ProductoRevisionEntity, {
          productoId: id,
          estatusResultante: estatus,
          revisadoPor: solicitante.id,
          motivo,
          revisadoEn: new Date(),
        }),
      );

      return manager.findOneOrFail(ProductoEntity, { where: { id }, relations: { presentaciones: true } });
    });
  }

  /**
   * Con QueryBuilder las relaciones `eager` NO se cargan solas: se unen
   * una por una para devolver la misma forma que `findOne`.
   */
  private consultaProductos() {
    return this.productosRepo
      .createQueryBuilder('p')
      .leftJoinAndSelect('p.categoria', 'c')
      .leftJoinAndSelect('p.proveedor', 'prov')
      .leftJoinAndSelect('p.presentaciones', 'pres')
      .leftJoinAndSelect('pres.unidadMedida', 'u');
  }

  /**
   * Producto y su primera presentación se crean juntos o no se crea
   * ninguno: un producto sin presentación no se puede vender ni cotizar.
   */
  private crearConPresentacion(
    datos: Partial<ProductoEntity>,
    primera: { nombre: string; contenido: number; unidadMedidaId: number },
  ): Promise<ProductoEntity> {
    return this.dataSource.transaction(async (manager) => {
      const guardado = await manager.save(manager.create(ProductoEntity, datos));
      await manager.save(
        manager.create(ProductoPresentacionEntity, {
          productoId: guardado.id,
          nombre: primera.nombre,
          contenido: String(primera.contenido),
          unidadMedidaId: primera.unidadMedidaId,
          esPredeterminada: true,
          activo: true,
        }),
      );
      return manager.findOneOrFail(ProductoEntity, {
        where: { id: guardado.id },
        relations: { presentaciones: true },
      });
    });
  }

  /**
   * Resuelve la empresa proveedora del usuario autenticado.
   *
   * El vínculo es el correo: `usuarios` no tiene FK a `proveedores`
   * (así quedó el esquema), y tanto `usuarios.email` como
   * `proveedores.email` son UNIQUE, así que la correspondencia es 1 a 1.
   */
  private async proveedorDe(solicitante: SesionUsuario) {
    const proveedor = await this.proveedoresRepo.findOne({ where: { email: solicitante.email } });
    if (!proveedor) {
      throw new ForbiddenException(
        'Tu cuenta tiene rol Proveedor pero no está vinculada a ninguna empresa proveedora. Contacta al Administrador.',
      );
    }
    return proveedor;
  }

  private async exigirCategoria(categoriaId: number) {
    const categoria = await this.categoriasRepo.findOne({ where: { id: categoriaId } });
    if (!categoria) {
      throw new BadRequestException('La categoría indicada no existe.');
    }
  }

  private async exigirUnidad(clave: string) {
    const unidad = await this.unidadesRepo.findOne({ where: { clave } });
    if (!unidad) {
      throw new BadRequestException(`La unidad de medida '${clave}' no existe en el catálogo.`);
    }
    return unidad;
  }

  private async rechazarSkuRepetido(sku: string) {
    const duplicado = await this.productosRepo.findOne({ where: { sku } });
    if (duplicado) {
      throw new ConflictException(`Ya existe un producto con el SKU ${sku}.`);
    }
  }
}
