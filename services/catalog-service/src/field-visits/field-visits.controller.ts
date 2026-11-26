import { Body, Controller, Headers, Ip, Post, Res, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { SessionGuard, SesionUsuario } from '../common/auth/session.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { XmlRoot } from '../common/decorators/xml-root.decorator';
import { RolesGuard } from '../common/guards/roles.guard';
import { ROL } from '../common/roles';
import { ApiErrores, ApiRespuesta } from '../common/swagger/ejemplos';
import { muestras } from '../common/swagger/muestras';
import { CreateFieldVisitDto } from './dto/create-field-visit.dto';
import { FieldVisitsService } from './field-visits.service';

/**
 * Visitas de campo (D-30): ubicación (RF-37) y encuesta (RF-38) desde la app
 * móvil, en MongoDB `visitas_campo`. Solo el alta: D-28 da al Investigador de
 * mercado alta de "ubicación de la visita y respuestas de encuesta"; quién LEE
 * las visitas no está decidido (hallazgo de especificación), así que no hay GET.
 */
@ApiTags('Field visits (D-30)')
@ApiBearerAuth()
@UseGuards(SessionGuard, RolesGuard)
@Controller('field-visits')
export class FieldVisitsController {
  constructor(private readonly visitas: FieldVisitsService) {}

  @Post()
  @XmlRoot('fieldVisitResponse')
  @Roles(ROL.INVESTIGADOR)
  @ApiOperation({
    summary: 'Registra una visita de campo con ubicación GPS y respuestas de encuesta (Investigador de mercado, D-28/D-30).',
    description:
      'Idempotente por `visitId` generado en el dispositivo (D-42): 201 = nueva; 200 = reenvío de una ya recibida (sin crear otra); ' +
      '409 = ese id es de otra captura. MongoDB caído → 503 y el dispositivo reintenta.',
  })
  @ApiRespuesta(201, 'Visita registrada.', muestras.visitaCampo, 'fieldVisitResponse')
  @ApiRespuesta(200, 'Reenvío: la visita original.', muestras.visitaCampo, 'fieldVisitResponse')
  @ApiErrores(400, 401, 403, 409, 503)
  async registrar(
    @Body() dto: CreateFieldVisitDto,
    @CurrentUser() usuario: SesionUsuario,
    @Headers('authorization') token: string | undefined,
    @Ip() ip: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { visita, duplicada } = await this.visitas.registrar(dto, usuario, token, ip);
    res.status(duplicada ? 200 : 201);
    return visita;
  }
}
