import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { RegisterProveedorDto } from './dto/register-proveedor.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  /** Pantalla "Registro de proveedor" del wireframe. Único auto-registro del sistema. */
  @Post('register/proveedor')
  @HttpCode(HttpStatus.CREATED)
  registerProveedor(@Body() dto: RegisterProveedorDto) {
    return this.authService.registerProveedor(dto);
  }

  /** Pantalla "Iniciar sesión" del wireframe. Sirve para todos los roles. */
  @Post('login')
  @HttpCode(HttpStatus.OK)
  login(@Body() dto: LoginDto) {
    return this.authService.login(dto);
  }

  /** Renueva el access token usando un refresh token vigente. */
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  refresh(@Body() dto: RefreshTokenDto) {
    return this.authService.refresh(dto.refreshToken);
  }

  /** Endpoint de ejemplo protegido: valida que el JWT viaje y sea válido. */
  @Get('me')
  @UseGuards(JwtAuthGuard)
  me(@CurrentUser() user: unknown) {
    return user;
  }
}
