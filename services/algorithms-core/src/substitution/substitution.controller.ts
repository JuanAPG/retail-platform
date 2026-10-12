import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { SessionGuard } from '../common/auth/session.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { RolesGuard } from '../common/guards/roles.guard';
import { PERFILES_INTERNOS } from '../common/roles';
import { ApiErrores, RespuestaXml } from '../common/swagger/ejemplos';
import { muestras } from '../common/swagger/muestras';
import { SubstitutionQueryDto } from './dto/substitution-query.dto';
import { SubstitutionService } from './substitution.service';

/**
 * M11 — Patrones de sustitución (RF-17). Es lectura: no crea corrida, así
 * que la ven los seis perfiles internos. La Matriz deja PENDIENTE (P-07) si
 * sustitución va con Asociación o con Elasticidad; en las dos todos los
 * internos tienen al menos Lectura, así que no hace falta asumir nada.
 */
@ApiTags('M11 Substitution')
@ApiBearerAuth()
@UseGuards(SessionGuard, RolesGuard)
@Controller('substitution')
export class SubstitutionController {
  constructor(private readonly substitutionService: SubstitutionService) {}

  @Get('patterns')
  @Roles(...PERFILES_INTERNOS)
  @ApiOperation({
    summary: 'Indicios de sustitución entre productos de una misma categoría (se calculan al vuelo).',
    description:
      'Pares de la categoría que se compran juntos menos de lo esperado (lift < 1, medido sobre las canastas ' +
      'con productos de la categoría, y solo si por azar se esperaba verlos juntos al menos una vez). ' +
      "Tipo 'precio' si además el precio vigente de A (histórico de pricing) se correlaciona con comprar B " +
      "(r ≥ 0.3); si no, 'preferencia'. Mínimo 2 canastas por producto. Cada par trae su evidencia y es un " +
      'INDICIO, no una causa. No detecta desabasto: no hay historial de inventario. No se guarda.',
  })
  @RespuestaXml(
    200,
    'Indicios de sustitución de la categoría, del más fuerte al más débil; [] si no hay datos suficientes.',
    muestras.patronesSustitucion,
    'substitutionPatternListResponse',
    { siemprePresentes: ['priceCorrelation', 'priceVariation', 'originFrequencyChange', 'targetFrequencyChange'] },
  )
  @ApiErrores(400, 401, 403, 404, 503)
  detectPatterns(@Query() query: SubstitutionQueryDto) {
    return this.substitutionService.detectPatterns(query.categoryId);
  }
}
