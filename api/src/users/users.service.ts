import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import * as bcrypt from 'bcrypt';
import { QueryFailedError, Repository } from 'typeorm';
import { UsuarioEntity } from '../entities/usuario.entity';
import { RoleEntity } from '../entities/role.entity';
import { CreateUsuarioDto } from './dto/create-usuario.dto';
import { UpdateUsuarioDto } from './dto/update-usuario.dto';

/** Código de Postgres para violación de llave foránea. */
const PG_FOREIGN_KEY_VIOLATION = '23503';

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(UsuarioEntity)
    private readonly usuariosRepo: Repository<UsuarioEntity>,
    @InjectRepository(RoleEntity)
    private readonly rolesRepo: Repository<RoleEntity>,
    private readonly configService: ConfigService,
  ) {}

  // ---------------------------------------------------------------
  // Lecturas usadas por AuthService / JwtStrategy
  // ---------------------------------------------------------------

  findByEmail(email: string): Promise<UsuarioEntity | null> {
    return this.usuariosRepo.findOne({ where: { email } });
  }

  findById(id: string): Promise<UsuarioEntity | null> {
    return this.usuariosRepo.findOne({ where: { id } });
  }

  findRoleByName(nombre: string): Promise<RoleEntity | null> {
    return this.rolesRepo.findOne({ where: { nombre } });
  }

  findAllRoles(): Promise<RoleEntity[]> {
    return this.rolesRepo.find({ order: { id: 'ASC' } });
  }

  // ---------------------------------------------------------------
  // CRUD (Portal Admin)
  // ---------------------------------------------------------------

  async findAll() {
    const usuarios = await this.usuariosRepo.find({ order: { nombre: 'ASC' } });
    return usuarios.map((usuario) => this.toPublic(usuario));
  }

  async findOne(id: string) {
    return this.toPublic(await this.obtenerOFallar(id));
  }

  async create(dto: CreateUsuarioDto) {
    await this.validarEmailLibre(dto.email);
    await this.validarRol(dto.rolId);

    const usuario = this.usuariosRepo.create({
      nombre: dto.nombre,
      email: dto.email,
      passwordHash: await this.hashPassword(dto.password),
      rolId: dto.rolId,
      activo: dto.activo ?? true,
    });

    const guardado = await this.usuariosRepo.save(usuario);

    // Se relee para que la respuesta incluya el rol (relación eager) y
    // los timestamps que genera la base, no solo lo que se mandó.
    return this.findOne(guardado.id);
  }

  async update(id: string, dto: UpdateUsuarioDto, solicitanteId: string) {
    const usuario = await this.obtenerOFallar(id);

    // Un Administrador no puede quitarse a sí mismo el acceso: si se
    // desactiva o se cambia de rol, pierde el portal en el siguiente
    // request y podría no quedar nadie que pueda revertirlo.
    if (usuario.id === solicitanteId) {
      if (dto.activo === false) {
        throw new ConflictException('No puedes desactivar tu propia cuenta.');
      }
      if (dto.rolId !== undefined && dto.rolId !== usuario.rolId) {
        throw new ConflictException('No puedes cambiar tu propio rol.');
      }
    }

    if (dto.email && dto.email !== usuario.email) {
      await this.validarEmailLibre(dto.email);
      usuario.email = dto.email;
    }
    if (dto.rolId !== undefined && dto.rolId !== usuario.rolId) {
      await this.validarRol(dto.rolId);
      usuario.rolId = dto.rolId;
    }
    if (dto.nombre !== undefined) usuario.nombre = dto.nombre;
    if (dto.activo !== undefined) usuario.activo = dto.activo;
    if (dto.password) usuario.passwordHash = await this.hashPassword(dto.password);

    await this.usuariosRepo.save(usuario);
    return this.findOne(usuario.id);
  }

  async remove(id: string, solicitanteId: string) {
    const usuario = await this.obtenerOFallar(id);

    if (usuario.id === solicitanteId) {
      throw new ConflictException('No puedes eliminar tu propia cuenta.');
    }

    try {
      await this.usuariosRepo.remove(usuario);
    } catch (error) {
      // `productos.aprobado_por` y otras tablas referencian usuarios.id.
      // Borrar a alguien que ya operó en el sistema destruiría esa
      // trazabilidad, así que Postgres lo impide y aquí se traduce a un
      // mensaje accionable en lugar de un 500.
      if (
        error instanceof QueryFailedError &&
        (error.driverError as { code?: string })?.code === PG_FOREIGN_KEY_VIOLATION
      ) {
        throw new ConflictException(
          'No se puede eliminar este usuario porque tiene registros asociados en el sistema. Desactívalo en su lugar.',
        );
      }
      throw error;
    }

    return { mensaje: 'Usuario eliminado.', id };
  }

  // ---------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------

  /** Elimina password_hash antes de exponer el usuario en una respuesta HTTP. */
  toPublic(usuario: UsuarioEntity) {
    const { passwordHash, ...publicUser } = usuario;
    return {
      ...publicUser,
      rol: usuario.rol?.nombre,
    };
  }

  private async obtenerOFallar(id: string): Promise<UsuarioEntity> {
    const usuario = await this.usuariosRepo.findOne({ where: { id } });
    if (!usuario) {
      throw new NotFoundException('El usuario no existe.');
    }
    return usuario;
  }

  private async validarEmailLibre(email: string): Promise<void> {
    const existente = await this.findByEmail(email);
    if (existente) {
      throw new ConflictException('Ya existe una cuenta con este correo electrónico.');
    }
  }

  private async validarRol(rolId: number): Promise<void> {
    const rol = await this.rolesRepo.findOne({ where: { id: rolId } });
    if (!rol) {
      throw new BadRequestException('El rol seleccionado no existe.');
    }
  }

  private hashPassword(password: string): Promise<string> {
    const saltRounds = this.configService.getOrThrow<number>('jwt.bcryptSaltRounds');
    return bcrypt.hash(password, saltRounds);
  }
}
