import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Ip,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { SessionGuard, SesionUsuario } from '../common/auth/session.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { ROL } from '../common/roles';
import { PaginationDto } from '../common/dto/pagination.dto';
import { UsersService } from './users.service';
import { CreateUsuarioDto } from './dto/create-usuario.dto';
import { UpdateUsuarioDto } from './dto/update-usuario.dto';

/**
 * CRUD de usuarios. Lectura para Administrador y Auditor; escritura solo
 * Administrador. El prefijo `/v1` lo pone el global prefix: aquí `usuarios`.
 */
@ApiTags('v1 Usuarios')
@ApiBearerAuth()
@UseGuards(SessionGuard, RolesGuard)
@Controller('usuarios')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get()
  @Roles(ROL.ADMINISTRADOR, ROL.AUDITOR)
  findAll(@Query() filtros: PaginationDto) {
    return this.usersService.findAll(filtros);
  }

  @Get(':id')
  @Roles(ROL.ADMINISTRADOR, ROL.AUDITOR)
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.usersService.findOne(id);
  }

  @Post()
  @Roles(ROL.ADMINISTRADOR)
  @HttpCode(HttpStatus.CREATED)
  create(
    @Body() dto: CreateUsuarioDto,
    @CurrentUser() solicitante: SesionUsuario,
    @Ip() ip: string,
  ) {
    return this.usersService.create(dto, solicitante, ip);
  }

  @Patch(':id')
  @Roles(ROL.ADMINISTRADOR)
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateUsuarioDto,
    @CurrentUser() solicitante: SesionUsuario,
    @Ip() ip: string,
  ) {
    return this.usersService.update(id, dto, solicitante.id, ip);
  }

  @Delete(':id')
  @Roles(ROL.ADMINISTRADOR)
  remove(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() solicitante: SesionUsuario,
    @Ip() ip: string,
  ) {
    return this.usersService.remove(id, solicitante.id, ip);
  }
}
