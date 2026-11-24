import { Body, Controller, Headers, HttpCode, HttpStatus, Ip, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { SessionGuard, SesionUsuario } from '../common/auth/session.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { XmlRoot } from '../common/decorators/xml-root.decorator';
import { LoginRateLimitGuard } from './login-rate-limit.guard';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { RegisterProveedorDto } from './dto/register-proveedor.dto';
import { ValidateTokenDto } from './dto/validate-token.dto';

/**
 * Identidad y sesiones. Las rutas públicas (register, login, refresh,
 * validate) no llevan guard; `logout` exige sesión viva en Redis.
 * El prefijo `/v1` lo pone el global prefix de `main.ts`: aquí solo `auth`.
 *
 * Cada handler declara su `@XmlRoot` con el elemento que le corresponde en
 * `docs/contratos/auth-service.xsd`. Sin el decorador el interceptor emite
 * `<response>`, que el XSD no declara: así ninguna respuesta de éxito de este
 * servicio validaba contra su propio contrato.
 */
@ApiTags('v1 Auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('register/proveedor')
  @HttpCode(HttpStatus.CREATED)
  @XmlRoot('registroProveedorResponse')
  @ApiOperation({ summary: 'Solicitud de alta de proveedor (nace inactiva).' })
  registerProveedor(@Body() dto: RegisterProveedorDto, @Ip() ip: string) {
    return this.authService.registerProveedor(dto, ip);
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @XmlRoot('loginResponse')
  @UseGuards(LoginRateLimitGuard)
  @ApiResponse({ status: 429, description: 'Límite de intentos alcanzado.', headers: {
    'Retry-After': { description: 'Segundos hasta que termina la ventana.', schema: { type: 'integer' } },
  } })
  @ApiResponse({ status: 503, description: 'Redis no permite verificar el límite.' })
  @ApiOperation({ summary: 'Inicia sesión y abre sesión en Redis.' })
  login(@Body() dto: LoginDto, @Ip() ip: string) {
    return this.authService.login(dto, ip);
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @XmlRoot('refreshResponse')
  @ApiOperation({ summary: 'Rota el par de tokens (el anterior muere).' })
  refresh(@Body() dto: RefreshTokenDto, @Ip() ip: string) {
    return this.authService.refresh(dto, ip);
  }

  @Post('logout')
  @HttpCode(HttpStatus.OK)
  @XmlRoot('logoutResponse')
  @ApiBearerAuth()
  @UseGuards(SessionGuard)
  @ApiOperation({ summary: 'Cierra la sesión: borra Redis y revoca el refresh.' })
  logout(
    @CurrentUser() usuario: SesionUsuario,
    @Ip() ip: string,
    @Headers('authorization') token: string | undefined,
  ) {
    return this.authService.logout(usuario, ip, token);
  }

  @Post('validate')
  @HttpCode(HttpStatus.OK)
  @XmlRoot('validateResponse')
  @ApiOperation({ summary: 'Introspección para servicios que validan remoto (fallback).' })
  validate(@Body() dto: ValidateTokenDto) {
    return this.authService.validate(dto.token);
  }
}
