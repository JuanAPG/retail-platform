import { Controller, Get, Headers, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { SessionGuard } from '../common/auth/session.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { XmlRoot } from '../common/decorators/xml-root.decorator';
import { RolesGuard } from '../common/guards/roles.guard';
import { PERFILES_INTERNOS } from '../common/roles';
import { ApiErrores, ApiRespuesta } from '../common/swagger/ejemplos';
import { muestras } from '../common/swagger/muestras';
import { PublicationQueryDto } from './dto/publication.dto';
import { PublicationService } from './publication.service';

/** D-36: qué combinaciones zona-segmento tienen datos suficientes para publicarse. */
@ApiTags('Publication')
@ApiBearerAuth()
@UseGuards(SessionGuard, RolesGuard)
@Controller('publication')
export class PublicationController {
  constructor(private readonly publication: PublicationService) {}

  @Get('zone-segments')
  @XmlRoot('publicationResponse')
  @Roles(...PERFILES_INTERNOS)
  @ApiOperation({
    summary: 'Por zona clasificada: si su combinación zona-segmento se puede publicar (D-36).',
    description:
      'Con menos de 10 transacciones y menos de 3 tiendas sale `disponible: false` con motivo y sin `averageTicket` (nunca un número). ' +
      'Cuando solo se cumple un umbral decide `PUBLICATION_RULE` (D-48: por defecto `ambos`, no publica). Sin paginar.',
  })
  @ApiRespuesta(200, 'Umbrales usados y una fila por zona clasificada.', muestras.publicacion, 'publicationResponse')
  @ApiErrores(400, 401, 403)
  zoneSegments(@Query() query: PublicationQueryDto, @Headers('authorization') token?: string) {
    return this.publication.zoneSegments(query, token);
  }
}
