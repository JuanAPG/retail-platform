import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { UsuarioEntity } from '../entities/usuario.entity';
import { RoleEntity } from '../entities/role.entity';
import { UsersService } from './users.service';
import { UsersController } from './users.controller';
import { RolesController } from './roles.controller';

@Module({
  imports: [TypeOrmModule.forFeature([UsuarioEntity, RoleEntity])],
  controllers: [UsersController, RolesController],
  providers: [UsersService],
  exports: [UsersService],
})
export class UsersModule {}
