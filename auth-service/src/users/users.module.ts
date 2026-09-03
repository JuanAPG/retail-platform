import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { UsuarioEntity } from '../entities/usuario.entity';
import { RoleEntity } from '../entities/role.entity';
import { UsersService } from './users.service';

@Module({
  imports: [TypeOrmModule.forFeature([UsuarioEntity, RoleEntity])],
  providers: [UsersService],
  exports: [UsersService],
})
export class UsersModule {}
