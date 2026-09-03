import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { UsuarioEntity } from '../entities/usuario.entity';
import { RoleEntity } from '../entities/role.entity';

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(UsuarioEntity)
    private readonly usuariosRepo: Repository<UsuarioEntity>,
    @InjectRepository(RoleEntity)
    private readonly rolesRepo: Repository<RoleEntity>,
  ) {}

  findByEmail(email: string): Promise<UsuarioEntity | null> {
    return this.usuariosRepo.findOne({ where: { email } });
  }

  findById(id: string): Promise<UsuarioEntity | null> {
    return this.usuariosRepo.findOne({ where: { id } });
  }

  findRoleByName(nombre: string): Promise<RoleEntity | null> {
    return this.rolesRepo.findOne({ where: { nombre } });
  }

  /** Elimina password_hash antes de exponer el usuario en una respuesta HTTP. */
  toPublic(usuario: UsuarioEntity) {
    const { passwordHash, ...publicUser } = usuario;
    return {
      ...publicUser,
      rol: usuario.rol?.nombre,
    };
  }
}
