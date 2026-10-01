import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ModuloEntity } from '../entities/modulo.entity';
import { RolModuloPermisoEntity, NivelPermiso } from '../entities/rol-modulo-permiso.entity';
import { RoleEntity } from '../entities/role.entity';
import { AuditReporter } from '../common/audit/audit-reporter.service';
import { ActorAuditoria } from './users.service';

const NIVELES: NivelPermiso[] = [
  'total',
  'lectura_actualiza',
  'lectura',
  'propone',
  'aprueba',
  'lectura_propios',
  'sin_acceso',
];

export interface PermisoEntrada {
  moduloId?: number;
  clave?: string;
  nivel: NivelPermiso;
}

/**
 * Matriz rol × módulo (`rol_modulo_permiso`). Los 7 roles y los módulos
 * M01–M15 vienen del seed; aquí solo se consulta y se reemplaza el nivel
 * por rol. Sin filas = `sin_acceso` (default de la tabla).
 */
@Injectable()
export class RolesService {
  constructor(
    @InjectRepository(RoleEntity)
    private readonly rolesRepo: Repository<RoleEntity>,
    @InjectRepository(ModuloEntity)
    private readonly modulosRepo: Repository<ModuloEntity>,
    @InjectRepository(RolModuloPermisoEntity)
    private readonly permisosRepo: Repository<RolModuloPermisoEntity>,
    private readonly auditoria: AuditReporter,
  ) {}

  async matrizDe(rolId: number) {
    const rol = await this.rolesRepo.findOne({ where: { id: rolId } });
    if (!rol) throw new NotFoundException('El rol no existe.');
    const modulos = await this.modulosRepo.find({ order: { clave: 'ASC' } });
    const permisos = await this.permisosRepo.find({ where: { rolId } });
    const porModulo = new Map(permisos.map((p) => [p.moduloId, p.nivel]));
    return {
      rolId: rol.id,
      rol: rol.nombre,
      permisos: modulos.map((m) => ({
        moduloId: m.id,
        clave: m.clave,
        modulo: m.nombre,
        nivel: porModulo.get(m.id) ?? 'sin_acceso',
      })),
    };
  }

  async reemplazarMatriz(
    rolId: number,
    entradas: PermisoEntrada[],
    actor?: ActorAuditoria | null,
    ip?: string,
  ) {
    const rol = await this.rolesRepo.findOne({ where: { id: rolId } });
    if (!rol) throw new NotFoundException('El rol no existe.');

    const modulos = await this.modulosRepo.find();
    const porId = new Map(modulos.map((m) => [m.id, m]));
    const porClave = new Map(modulos.map((m) => [m.clave, m]));

    const filas: RolModuloPermisoEntity[] = [];
    for (const entrada of entradas) {
      const modulo = entrada.moduloId !== undefined ? porId.get(entrada.moduloId) : undefined;
      const porClaveOk = entrada.clave !== undefined ? porClave.get(entrada.clave) : undefined;
      const destino = modulo ?? porClaveOk;
      if (!destino) {
        throw new NotFoundException(
          `El módulo ${entrada.moduloId ?? entrada.clave} no existe.`,
        );
      }
      if (!NIVELES.includes(entrada.nivel)) {
        throw new BadRequestException(`El nivel ${entrada.nivel} no es válido.`);
      }
      filas.push(
        this.permisosRepo.create({ rolId, moduloId: destino.id, nivel: entrada.nivel }),
      );
    }

    await this.permisosRepo.delete({ rolId });
    if (filas.length > 0) await this.permisosRepo.save(filas);

    await this.auditoria.reportar({
      tabla: 'rol_modulo_permiso',
      registroId: String(rolId),
      accion: 'update',
      descripcion: `Matriz de permisos reemplazada para el rol ${rol.nombre} (${filas.length} módulos).`,
      usuarioId: actor?.id ?? null,
      rolId: actor?.rolId ?? null,
      ip,
      cambios: [{ campo: 'permisos', previo: null, posterior: `${filas.length} módulos` }],
    });

    return this.matrizDe(rolId);
  }
}
