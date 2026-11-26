import { Body, Controller, Get, Headers, Ip, Param, ParseUUIDPipe, Post, Query, Res, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { SessionGuard, SesionUsuario } from '../common/auth/session.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { XmlRoot } from '../common/decorators/xml-root.decorator';
import { RolesGuard } from '../common/guards/roles.guard';
import { LEEN_VISITAS, ROL } from '../common/roles';
import { ApiErrores, ApiRespuesta, pagina } from '../common/swagger/ejemplos';
import { FieldVisitFilterDto } from './dto/field-visit-filter.dto';
import { muestras } from '../common/swagger/muestras';
import { CreateFieldVisitDto } from './dto/create-field-visit.dto';
import { FieldVisitsService } from './field-visits.service';

/**
 * Visitas de campo (D-30): ubicación (RF-37) y encuesta (RF-38) desde la app
 * móvil, en MongoDB `visitas_campo`. Alta: Investigador de mercado (D-28).
 * Lectura: Analista comercial, Administrador y Auditor (D-52), por tienda,
 * zona y fecha; nunca por persona.
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

  @Get()
  @XmlRoot('fieldVisitListResponse')
  @Roles(...LEEN_VISITAS)
  @ApiOperation({ summary: 'Visitas de campo, paginadas, la más reciente primero (D-52: Analista, Administrador, Auditor). Por tienda, zona y fecha.' })
  @ApiRespuesta(200, 'Página de visitas.', pagina([muestras.visitaCampo]), 'fieldVisitListResponse')
  @ApiErrores(400, 401, 403, 503)
  listar(@Query() filtros: FieldVisitFilterDto) {
    return this.visitas.listar(filtros);
  }

  @Get(':visitId')
  @XmlRoot('fieldVisitResponse')
  @Roles(...LEEN_VISITAS)
  @ApiOperation({ summary: 'Una visita de campo (D-52).' })
  @ApiRespuesta(200, 'La visita.', muestras.visitaCampo, 'fieldVisitResponse')
  @ApiErrores(400, 401, 403, 404, 503)
  obtener(@Param('visitId', new ParseUUIDPipe()) visitId: string) {
    return this.visitas.obtener(visitId);
  }
}
