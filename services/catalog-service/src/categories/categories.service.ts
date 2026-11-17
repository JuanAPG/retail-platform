import { BadRequestException, ConflictException, Injectable, NotFoundException, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { QueryFailedError, Repository } from 'typeorm';
import { CacheService } from '../common/cache/cache.service';
import { LLAVES_CATALOGO } from '../common/cache/catalogos';
import { ResultadoBaja } from '../common/helpers/historial.helper';
import { CategoriaProductoEntity } from '../entities/categoria-producto.entity';
import { ProductoEntity } from '../entities/producto.entity';
import { CreateCategoryDto, UpdateCategoryDto } from './dto/category.dto';

function codigoSql(err: unknown): string | undefined {
  return err instanceof QueryFailedError ? (err as unknown as { code?: string }).code : undefined;
}

/**
 * T-21 — alta, cambio y baja de categorías de producto (M04: las escribe el Gerente de categoría).
 *
 * D-07: una categoría con productos (o con subcategorías, o usada en un análisis) NO se borra:
 * se desactiva. Desactivada, sus productos la conservan, pero ya no se ofrece para productos nuevos.
 *
 * El catálogo de categorías activas está cacheado en Redis: toda escritura borra esa llave.
 */
@Injectable()
export class CategoriesService implements OnModuleInit {
  constructor(
    @InjectRepository(CategoriaProductoEntity)
    private readonly categoriasRepo: Repository<CategoriaProductoEntity>,
    @InjectRepository(ProductoEntity)
    private readonly productosRepo: Repository<ProductoEntity>,
    private readonly cache: CacheService,
  ) {}

  /**
   * Al arrancar se borra el catálogo cacheado: una versión anterior del servicio pudo dejar
   * categorías sin el campo `activo`, y ese XML no validaría contra el XSD hasta caducar.
   */
  async onModuleInit(): Promise<void> {
    await this.cache.borrar(LLAVES_CATALOGO.categorias);
  }

  async findOne(id: number): Promise<CategoriaProductoEntity> {
    // Fuera del rango de SMALLINT no puede existir (y Postgres respondería error, no vacío).
    const categoria = id >= 1 && id <= 32767 ? await this.categoriasRepo.findOne({ where: { id } }) : null;
    if (!categoria) throw new NotFoundException('La categoría no existe.');
    return categoria;
  }

  async create(dto: CreateCategoryDto): Promise<CategoriaProductoEntity> {
    await this.rechazarNombreRepetido(dto.nombre);
    if (dto.categoriaPadreId != null) await this.exigirPadre(dto.categoriaPadreId);
    const guardada = await this.guardar(
      this.categoriasRepo.create({
        nombre: dto.nombre.trim(),
        categoriaPadreId: dto.categoriaPadreId ?? null,
        descripcion: dto.descripcion ?? null,
        activo: true,
      }),
    );
    return this.findOne(guardada.id);
  }

  async update(id: number, dto: UpdateCategoryDto): Promise<CategoriaProductoEntity> {
    const categoria = await this.findOne(id);

    if (dto.nombre !== undefined && dto.nombre.trim() !== categoria.nombre) {
      await this.rechazarNombreRepetido(dto.nombre, id);
      categoria.nombre = dto.nombre.trim();
    }
    if (dto.categoriaPadreId !== undefined) {
      if (dto.categoriaPadreId !== null) {
        await this.exigirPadre(dto.categoriaPadreId);
        await this.rechazarCiclo(id, dto.categoriaPadreId);
      }
      categoria.categoriaPadreId = dto.categoriaPadreId;
    }
    if (dto.descripcion !== undefined) categoria.descripcion = dto.descripcion;
    if (dto.activo !== undefined) categoria.activo = dto.activo;

    await this.guardar(categoria);
    return this.findOne(id);
  }

  /**
   * D-07: sin productos, sin subcategorías y sin nada que dependa de ella, se borra. Si algo
   * depende, queda `activo = false` y se devuelve la categoría.
   */
  async remove(id: number): Promise<ResultadoBaja<CategoriaProductoEntity>> {
    const categoria = await this.findOne(id);
    const [productos, hijas] = await Promise.all([
      this.productosRepo.count({ where: { categoriaId: id } }),
      this.categoriasRepo.count({ where: { categoriaPadreId: id } }),
    ]);
    if (productos === 0 && hijas === 0) {
      try {
        await this.categoriasRepo.remove(categoria);
        await this.cache.borrar(LLAVES_CATALOGO.categorias);
        return { eliminado: true };
      } catch (err) {
        // 23503: la usa un indicador o una regla de exclusión de otro servicio. Tampoco se borra.
        if (codigoSql(err) !== '23503') throw err;
      }
    }
    categoria.id = id; // `remove` fallido puede dejar la entidad sin id.
    categoria.activo = false;
    await this.guardar(categoria);
    return { eliminado: false, entidad: await this.findOne(id) };
  }

  private async guardar(categoria: CategoriaProductoEntity): Promise<CategoriaProductoEntity> {
    try {
      const guardada = await this.categoriasRepo.save(categoria);
      await this.cache.borrar(LLAVES_CATALOGO.categorias);
      return guardada;
    } catch (err) {
      // 23505: dos altas simultáneas con el mismo nombre (índice único).
      if (codigoSql(err) === '23505') throw new ConflictException('Ya existe una categoría con ese nombre.');
      throw err;
    }
  }

  /** El nombre es único sin distinguir mayúsculas ni espacios de los extremos. */
  private async rechazarNombreRepetido(nombre: string, excluirId?: number) {
    const existente = await this.categoriasRepo
      .createQueryBuilder('c')
      .where('LOWER(c.nombre) = LOWER(:nombre)', { nombre: nombre.trim() })
      .getOne();
    if (existente && existente.id !== excluirId) {
      throw new ConflictException(`Ya existe una categoría con el nombre "${existente.nombre}".`);
    }
  }

  private async exigirPadre(padreId: number) {
    const padre = await this.categoriasRepo.findOne({ where: { id: padreId } });
    if (!padre) throw new BadRequestException('La categoría padre indicada no existe.');
    if (!padre.activo) throw new BadRequestException('La categoría padre indicada está desactivada.');
  }

  /** Una categoría no puede colgar de sí misma ni de una de sus descendientes. */
  private async rechazarCiclo(id: number, padreId: number) {
    const visitadas = new Set<number>();
    let actual: number | null = padreId;
    while (actual !== null && !visitadas.has(actual)) {
      if (actual === id) {
        throw new BadRequestException('Una categoría no puede ser subcategoría de sí misma ni de una de sus subcategorías.');
      }
      visitadas.add(actual);
      const siguiente: CategoriaProductoEntity | null = await this.categoriasRepo.findOne({ where: { id: actual } });
      actual = siguiente?.categoriaPadreId ?? null;
    }
  }
}
