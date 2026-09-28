import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, QueryFailedError, Repository } from 'typeorm';
import { TiendaEntity } from '../entities/tienda.entity';
import { DireccionEntity } from '../entities/direccion.entity';
import { CodigoPostalEntity } from '../entities/codigo-postal.entity';
import { ZonaEntity } from '../entities/zona.entity';
import { AuditContext, AuditService } from '../audit/audit.service';
import { CreateStoreDto } from './dto/create-store.dto';
import { UpdateStoreDto } from './dto/update-store.dto';

@Injectable()
export class StoresService {
  constructor(
    @InjectRepository(TiendaEntity)
    private readonly tiendasRepo: Repository<TiendaEntity>,
    @InjectRepository(CodigoPostalEntity)
    private readonly codigosPostalesRepo: Repository<CodigoPostalEntity>,
    @InjectRepository(ZonaEntity)
    private readonly zonasRepo: Repository<ZonaEntity>,
    private readonly dataSource: DataSource,
    private readonly audit: AuditService,
  ) {}

  findAll() {
    return this.tiendasRepo.find({ order: { nombre: 'ASC' } });
  }

  /** Catálogo para el formulario de alta: qué códigos postales son válidos. */
  findPostalCodes() {
    return this.codigosPostalesRepo.find({ order: { codigoPostal: 'ASC' } });
  }

  async findOne(id: string): Promise<TiendaEntity> {
    const tienda = await this.tiendasRepo.findOne({ where: { id } });
    if (!tienda) {
      throw new NotFoundException('La tienda no existe.');
    }
    return tienda;
  }

  /**
   * Crea la dirección y la tienda juntas. Se valida ANTES de insertar
   * (zona y código postal) para devolver un 400 legible en vez de que
   * la FK de Postgres truene con un mensaje críptico.
   */
  async create(dto: CreateStoreDto, ctx?: AuditContext): Promise<TiendaEntity> {
    const zona = await this.zonasRepo.findOne({ where: { id: dto.zonaId } });
    if (!zona) {
      throw new BadRequestException('La zona indicada no existe.');
    }

    const cp = await this.codigosPostalesRepo.findOne({ where: { codigoPostal: dto.codigoPostal } });
    if (!cp) {
      throw new BadRequestException(
        `El código postal ${dto.codigoPostal} no está en el catálogo. Pide que lo agreguen antes de dar de alta la tienda.`,
      );
    }

    const creada = await this.dataSource.transaction(async (manager) => {
      const direccion = manager.create(DireccionEntity, {
        calle: dto.calle,
        numeroExterior: dto.numeroExterior ?? null,
        numeroInterior: dto.numeroInterior ?? null,
        colonia: dto.colonia ?? null,
        codigoPostal: dto.codigoPostal,
      });
      const direccionGuardada = await manager.save(direccion);

      const tienda = manager.create(TiendaEntity, {
        nombre: dto.nombre,
        formato: dto.formato,
        zonaId: dto.zonaId,
        numeroSucursal: dto.numeroSucursal ?? null,
        proveedorId: dto.proveedorId ?? null,
        direccionId: direccionGuardada.id,
        activo: true,
      });
      const guardada = await manager.save(tienda);

      return manager.findOneOrFail(TiendaEntity, { where: { id: guardada.id } });
    });

    await this.audit.log({
      usuarioId: ctx?.actor?.id ?? null,
      rolId: ctx?.actor?.rolId ?? null,
      tabla: 'tiendas',
      registroId: creada.id,
      accion: 'insert',
      descripcion: `Tienda creada (${dto.nombre}).`,
      ip: ctx?.ip,
      cambios: [
        { campo: 'nombre', posterior: dto.nombre },
        { campo: 'formato', posterior: dto.formato },
        { campo: 'zonaId', posterior: dto.zonaId },
      ],
    });

    return creada;
  }

  /**
   * Edita la tienda y, si vienen campos de dirección en el DTO,
   * también actualiza esa dirección (es exclusiva de la tienda, no se
   * comparte con nadie más, así que no hay riesgo de pisar el domicilio
   * de otra sucursal).
   */
  async update(id: string, dto: UpdateStoreDto, ctx?: AuditContext): Promise<TiendaEntity> {
    const tienda = await this.findOne(id);
    const previo: Record<string, string> = {
      nombre: tienda.nombre,
      formato: tienda.formato,
      zonaId: tienda.zonaId,
      activo: String(tienda.activo),
    };

    if (dto.zonaId) {
      const zona = await this.zonasRepo.findOne({ where: { id: dto.zonaId } });
      if (!zona) {
        throw new BadRequestException('La zona indicada no existe.');
      }
    }

    if (dto.codigoPostal) {
      const cp = await this.codigosPostalesRepo.findOne({ where: { codigoPostal: dto.codigoPostal } });
      if (!cp) {
        throw new BadRequestException(`El código postal ${dto.codigoPostal} no está en el catálogo.`);
      }
    }

    const actualizada = await this.dataSource.transaction(async (manager) => {
      const camposDireccion: (keyof CreateStoreDto)[] = [
        'calle',
        'numeroExterior',
        'numeroInterior',
        'colonia',
        'codigoPostal',
      ];
      const hayCambioDeDireccion = camposDireccion.some((campo) => dto[campo] !== undefined);

      if (hayCambioDeDireccion) {
        await manager.update(DireccionEntity, { id: tienda.direccionId }, {
          ...(dto.calle !== undefined && { calle: dto.calle }),
          ...(dto.numeroExterior !== undefined && { numeroExterior: dto.numeroExterior }),
          ...(dto.numeroInterior !== undefined && { numeroInterior: dto.numeroInterior }),
          ...(dto.colonia !== undefined && { colonia: dto.colonia }),
          ...(dto.codigoPostal !== undefined && { codigoPostal: dto.codigoPostal }),
        });
      }

      Object.assign(tienda, {
        ...(dto.nombre !== undefined && { nombre: dto.nombre }),
        ...(dto.formato !== undefined && { formato: dto.formato }),
        ...(dto.zonaId !== undefined && { zonaId: dto.zonaId }),
        ...(dto.numeroSucursal !== undefined && { numeroSucursal: dto.numeroSucursal }),
        ...(dto.proveedorId !== undefined && { proveedorId: dto.proveedorId }),
        ...(dto.activo !== undefined && { activo: dto.activo }),
      });
      await manager.save(tienda);

      return manager.findOneOrFail(TiendaEntity, { where: { id } });
    });

    const posterior: Record<string, string> = {
      nombre: tienda.nombre,
      formato: tienda.formato,
      zonaId: tienda.zonaId,
      activo: String(tienda.activo),
    };
    await this.audit.log({
      usuarioId: ctx?.actor?.id ?? null,
      rolId: ctx?.actor?.rolId ?? null,
      tabla: 'tiendas',
      registroId: id,
      accion: 'update',
      descripcion: `Tienda actualizada (${tienda.nombre}).`,
      ip: ctx?.ip,
      cambios: Object.keys(previo)
        .filter((campo) => previo[campo] !== posterior[campo])
        .map((campo) => ({ campo, previo: previo[campo], posterior: posterior[campo] })),
    });

    return actualizada;
  }

  async remove(id: string, ctx?: AuditContext): Promise<void> {
    const tienda = await this.findOne(id);
    const nombre = tienda.nombre;

    try {
      await this.tiendasRepo.remove(tienda);
    } catch (err) {
      // 23503 = foreign_key_violation. `transacciones.tienda_id` NO tiene
      // ON DELETE CASCADE a propósito: no se puede borrar una tienda con
      // historial de ventas. Sin este catch, Postgres sube un 500 crudo.
      if (err instanceof QueryFailedError && (err as unknown as { code?: string }).code === '23503') {
        throw new ConflictException(
          'No se puede eliminar: esta tienda tiene transacciones u otros registros asociados. Desactívala en vez de borrarla.',
        );
      }
      throw err;
    }

    await this.audit.log({
      usuarioId: ctx?.actor?.id ?? null,
      rolId: ctx?.actor?.rolId ?? null,
      tabla: 'tiendas',
      registroId: id,
      accion: 'delete',
      descripcion: `Tienda eliminada (${nombre}).`,
      ip: ctx?.ip,
      cambios: [{ campo: 'nombre', previo: nombre, posterior: null }],
    });
  }
}
