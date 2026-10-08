import { Body, Controller, Get, Headers, Ip, Put, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiProperty, ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsNumber, Max, Min } from 'class-validator';
import { SessionGuard, SesionUsuario } from '../common/auth/session.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { XmlRoot } from '../common/decorators/xml-root.decorator';
import { RolesGuard } from '../common/guards/roles.guard';
import { CONFIGURAN_ALERTAS, VEN_ALERTAS } from '../common/roles';
import { ApiErrores, ApiRespuesta } from '../common/swagger/ejemplos';
import { muestras } from '../common/swagger/muestras';
import { PriceAlertsService } from './price-alerts.service';

/** Cuerpo de `PUT /v1/prices/alert-settings`. */
export class UpdateAlertSettingsDto {
  @ApiProperty({ example: 5, description: 'Variación acumulada (en %) que dispara la alerta. Mayor que 0, hasta 100.' })
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 }, { message: 'umbralPct debe ser numérico (hasta 2 decimales).' })
  @Min(0.01, { message: 'umbralPct debe ser mayor que 0.' })
  @Max(100, { message: 'umbralPct no puede pasar de 100.' })
  umbralPct: number;

  @ApiProperty({ example: 30, description: 'Ventana en días sobre la que se acumula el cambio (1 a 365).' })
  @Type(() => Number)
  @IsInt({ message: 'ventanaDias debe ser un entero.' })
  @Min(1, { message: 'ventanaDias debe ser al menos 1.' })
  @Max(365, { message: 'ventanaDias no puede pasar de 365.' })
  ventanaDias: number;
}

/**
 * PRI-07 / D-09 — Configuración de la alerta de cambio de precio. Contrato:
 * docs/contratos/pricing-service.md. Va ANTES de las rutas `/prices/*` con parámetros en el módulo
 * de precios: es una ruta literal (`alert-settings`), no un id.
 */
@ApiTags('M08 Price alerts')
@ApiBearerAuth()
@UseGuards(SessionGuard, RolesGuard)
@Controller('prices/alert-settings')
export class PriceAlertsController {
  constructor(private readonly alertas: PriceAlertsService) {}

  @Get()
  @XmlRoot('priceAlertSettingsResponse')
  @Roles(...VEN_ALERTAS)
  @ApiOperation({ summary: 'Umbral y ventana de la alerta de cambio de precio (por defecto 5 % en 30 días).' })
  @ApiRespuesta(200, 'Configuración vigente.', muestras.alertaConfig, 'priceAlertSettingsResponse')
  @ApiErrores(401, 403)
  get() {
    return this.alertas.getSettings();
  }

  @Put()
  @XmlRoot('priceAlertSettingsResponse')
  @Roles(...CONFIGURAN_ALERTAS)
  @ApiOperation({
    summary:
      'Define el umbral (%) y la ventana (días) de la alerta de cambio de precio acumulado. Solo el Responsable de precios.',
  })
  @ApiRespuesta(200, 'Configuración guardada.', muestras.alertaConfig, 'priceAlertSettingsResponse')
  @ApiErrores(400, 401, 403)
  update(
    @Body() dto: UpdateAlertSettingsDto,
    @CurrentUser() usuario: SesionUsuario,
    @Ip() ip: string,
    @Headers('authorization') token: string | undefined,
  ) {
    return this.alertas.updateSettings(dto, usuario, ip, token);
  }
}
