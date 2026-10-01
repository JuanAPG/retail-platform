import {
  Body,
  Controller,
  Get,
  Ip,
  Param,
  ParseIntPipe,
  Put,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { SessionGuard } from '../common/auth/session.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { ROL } from '../common/roles';
import { SesionUsuario } from '../common/auth/session.guard';
import { UsersService } from './users.service';
import { PermisoEntrada, RolesService } from './roles.service';
import { ReemplazarMatrizDto } from './dto/reemplazar-matriz.dto';

/**
 * Roles y matriz de permisos. Lectura para Administrador y Auditor
 * (el selector de rol del alta la necesita); escritura solo Administrador.
 */
@ApiTags('v1 Roles')
@ApiBearerAuth()
@UseGuards(SessionGuard, RolesGuard)
@Controller('roles')
export class RolesController {
  constructor(
    private readonly usersService: UsersService,
    private readonly rolesService: RolesService,
  ) {}

  @Get()
  @Roles(ROL.ADMINISTRADOR, ROL.AUDITOR)
  @ApiOperation({ summary: 'Los 7 perfiles (alimenta el selector de rol).' })
  findAll() {
    return this.usersService.findAllRoles();
  }

  @Get(':id/permisos')
  @Roles(ROL.ADMINISTRADOR, ROL.AUDITOR)
  @ApiOperation({ summary: 'Matriz rol × módulo con su nivel.' })
  matriz(@Param('id', ParseIntPipe) id: number) {
    return this.rolesService.matrizDe(id);
  }

  @Put(':id/permisos')
  @Roles(ROL.ADMINISTRADOR)
  @ApiOperation({ summary: 'Reemplaza la matriz completa de un rol.' })
  reemplazar(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: ReemplazarMatrizDto,
    @CurrentUser() solicitante: SesionUsuario,
    @Ip() ip: string,
  ) {
    const entradas: PermisoEntrada[] = dto.permisos.map((p) => ({
      ...(p.moduloId !== undefined && { moduloId: p.moduloId }),
      ...(p.clave !== undefined && { clave: p.clave }),
      nivel: p.nivel,
    }));
    return this.rolesService.reemplazarMatriz(id, entradas, solicitante, ip);
  }
}
