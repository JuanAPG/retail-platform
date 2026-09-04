import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { UsersService } from './users.service';
import { CreateUsuarioDto } from './dto/create-usuario.dto';
import { UpdateUsuarioDto } from './dto/update-usuario.dto';

interface UsuarioAutenticado {
  id: string;
  rol: string;
}

/**
 * CRUD de usuarios del Portal Admin.
 *
 * La lectura la comparten Administrador y Auditor (el Auditor consulta
 * cuentas como parte de su bitácora); la escritura es exclusiva del
 * Administrador, según S0_Matriz_de_Perfiles_y_Permisos.
 */
@ApiTags('usuarios')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('usuarios')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get()
  @Roles('Administrador', 'Auditor')
  findAll() {
    return this.usersService.findAll();
  }

  @Get(':id')
  @Roles('Administrador', 'Auditor')
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.usersService.findOne(id);
  }

  @Post()
  @Roles('Administrador')
  @HttpCode(HttpStatus.CREATED)
  create(@Body() dto: CreateUsuarioDto) {
    return this.usersService.create(dto);
  }

  @Patch(':id')
  @Roles('Administrador')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateUsuarioDto,
    @CurrentUser() solicitante: UsuarioAutenticado,
  ) {
    return this.usersService.update(id, dto, solicitante.id);
  }

  @Delete(':id')
  @Roles('Administrador')
  remove(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() solicitante: UsuarioAutenticado,
  ) {
    return this.usersService.remove(id, solicitante.id);
  }
}
