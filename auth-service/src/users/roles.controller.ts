import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { UsersService } from './users.service';

/** Alimenta el selector de rol del formulario de alta/edición de usuarios. */
@ApiTags('roles')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('roles')
export class RolesController {
  constructor(private readonly usersService: UsersService) {}

  @Get()
  @Roles('Administrador', 'Auditor')
  findAll() {
    return this.usersService.findAllRoles();
  }
}
