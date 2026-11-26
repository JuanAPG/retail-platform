import { Body, Controller, Get, Headers, HttpCode, Param, ParseUUIDPipe, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiOperation, ApiProduces, ApiTags } from '@nestjs/swagger';
import { SessionGuard, SesionUsuario } from '../common/auth/session.guard';
import { correlacionActual } from '../common/correlation/correlacion';
import { XmlRoot } from '../common/decorators/xml-root.decorator';
import { Roles, RolesGuard, UsuarioActual } from '../common/guards/roles.guard';
import { FiltroLotesDto, LoteSyncDto } from './dto/lote.dto';
import { ROLES_QUE_ENVIAN, ROLES_QUE_LEEN_TODO } from './reglas';
import {
  acuseEjemplo,
  ApiErrores,
  ApiRespuesta,
  ApiRespuestaVarias,
  listaEjemplo,
  loteEjemplo,
  reenvioEjemplo,
} from './swagger/ejemplos';
import { SyncService } from './sync.service';
import { Acuse, LoteEntrada } from './tipos';

const ROLES_QUE_LEEN = [...ROLES_QUE_LEEN_TODO, ...ROLES_QUE_ENVIAN];

/**
 * Rutas de `docs/contratos/offline-sync-service.md` (§1). Todas exigen JWT +
 * sesión activa en Redis (`SessionGuard`) y rol permitido (`RolesGuard`).
 */
@ApiTags('sync')
@ApiBearerAuth()
@Controller('sync/batches')
@UseGuards(SessionGuard, RolesGuard)
export class SyncController {
  constructor(private readonly sync: SyncService) {}

  @Post()
  @HttpCode(200)
  @Roles(...ROLES_QUE_ENVIAN)
  @XmlRoot('acuseLote')
  @ApiOperation({
    summary: 'Recibe un lote de capturas hechas sin conexión y devuelve el acuse por captura.',
    description:
      'JSON (app móvil) o XML con raíz loteSync (escritorio). 200 con cualquier mezcla de resultados: aceptada, duplicada, conflicto o rechazada (D-42). ' +
      'Reenviar el mismo lote devuelve el resultado guardado (resend: true). Roles: Investigador de mercado, Analista comercial, Responsable de precios. ' +
      '⚠️ Los destinos (availability, pricing) están SIMULADOS: el mapeo real está PENDIENTE de acuerdo con Pamela.',
  })
  @ApiConsumes('application/json', 'application/xml')
  @ApiProduces('application/json', 'application/xml')
  @ApiBody({ type: LoteSyncDto, examples: { lote: { summary: 'Lote mixto del contrato §4.1', value: loteEjemplo } } })
  @ApiRespuestaVarias(200, 'Lote procesado, con cualquier mezcla de resultados (también un reenvío). Acuse por captura.', 'acuseLote', {
    primerEnvio: { summary: 'Primer envío: lote mixto (§4.5)', value: acuseEjemplo },
    reenvio: { summary: 'Reenvío del mismo lote: todas duplicada con originalStatus (§4.8)', value: reenvioEjemplo },
  })
  @ApiErrores(400, 401, 403, 409, 413, 503)
  recibir(
    @Body() lote: LoteSyncDto,
    @UsuarioActual() usuario: SesionUsuario,
    @Headers('authorization') token: string,
  ): Promise<Acuse> {
    return this.sync.recibir(lote as LoteEntrada, usuario, token, correlacionActual() ?? 'sin-correlacion');
  }

  @Get()
  @Roles(...ROLES_QUE_LEEN)
  @XmlRoot('loteListResponse')
  @ApiOperation({
    summary: 'Lista paginada de lotes, el más reciente primero.',
    description: 'Administrador y Auditor ven todos; Investigador, Analista y Responsable de precios solo los suyos.',
  })
  @ApiProduces('application/json', 'application/xml')
  @ApiRespuesta(200, 'Página de lotes.', listaEjemplo, 'loteListResponse')
  @ApiErrores(400, 401, 403, 503)
  listar(@Query() filtros: FiltroLotesDto, @UsuarioActual() usuario: SesionUsuario) {
    return this.sync.listar(filtros, usuario);
  }

  @Get(':batchId')
  @Roles(...ROLES_QUE_LEEN)
  @XmlRoot('acuseLote')
  @ApiOperation({
    summary: 'Vuelve a entregar el acuse guardado de un lote (no reprocesa nada).',
    description: 'Un lote ajeno responde 404, igual que uno inexistente.',
  })
  @ApiProduces('application/json', 'application/xml')
  @ApiRespuesta(200, 'Acuse guardado.', acuseEjemplo, 'acuseLote')
  @ApiErrores(400, 401, 403, 404, 409, 503)
  obtener(
    @Param('batchId', new ParseUUIDPipe({ version: undefined })) batchId: string,
    @UsuarioActual() usuario: SesionUsuario,
  ): Promise<Acuse> {
    return this.sync.obtener(batchId, usuario);
  }
}
