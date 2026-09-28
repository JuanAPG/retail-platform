import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { PERFILES_INTERNOS } from '../common/roles';
import { SubstitutionService } from './substitution.service';
import { SubstitutionQueryDto } from './dto/substitution-query.dto';
import { SubstitutionPattern } from './dto/substitution-pattern.dto';

/**
 * M11 — Patrones de sustitución (S1-16). Controlador aparte porque el
 * contrato usa el prefijo /substitution; vive en el mismo módulo M11.
 */
@ApiTags('M11 Substitution')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('substitution')
export class SubstitutionController {
  constructor(private readonly substitutionService: SubstitutionService) {}

  @Get('patterns')
  @Roles(...PERFILES_INTERNOS)
  @ApiOperation({
    summary: 'Detecta pares de productos sustitutos dentro de una categoría.',
    // El contrato devuelve un arreglo: el método y sus supuestos se documentan aquí.
    description:
      'Pares de la categoría que se compran juntos menos de lo esperado (lift < 1, medido sobre las canastas ' +
      'con productos de la categoría, y solo si por azar se esperaba verlos juntos al menos una vez). ' +
      "Tipo 'precio' si además el precio vigente de A (histórico de M08) se correlaciona con comprar B " +
      "(r ≥ 0.3); si no, 'preferencia'. Mínimo 2 canastas por producto. No detecta 'desabasto': no hay " +
      'historial de inventario. Se calcula al vuelo y no se guarda.',
  })
  @ApiOkResponse({ type: [SubstitutionPattern] })
  detectPatterns(@Query() query: SubstitutionQueryDto) {
    return this.substitutionService.detectPatterns(query.categoryId);
  }
}
