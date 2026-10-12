import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { Priority, SERVICIOS_EMISORES, SourceService } from '../notification.types';

const PRIORIDADES: Priority[] = ['info', 'warning', 'critical'];

/** Lo que manda el emisor para crear una notificación. */
export class CreateNotificationDto {
  @ApiProperty({ example: 'precio.propuesto' })
  @IsString()
  @MaxLength(60)
  eventType: string;

  /**
   * Qué servicio origina el evento. OBLIGATORIO y de lista cerrada: antes
   * se aceptaba sin él y quedaba siempre `null`, así que no había forma de
   * saber de dónde venía una notificación ni de auditarla.
   */
  @ApiProperty({
    enum: SERVICIOS_EMISORES,
    example: 'pricing-service',
    description: 'Servicio que origina el evento. Lista cerrada.',
  })
  @IsIn(SERVICIOS_EMISORES as readonly string[], {
    message: `sourceService debe ser uno de: ${SERVICIOS_EMISORES.join(', ')}.`,
  })
  sourceService: SourceService;

  @ApiPropertyOptional({ example: 'presentacion' })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  relatedEntityType?: string;

  @ApiPropertyOptional({ example: 'uuid-presentacion' })
  @IsOptional()
  @IsString()
  relatedEntityId?: string;

  @ApiPropertyOptional({ description: 'Destinatario directo (si no, va por rol).' })
  @IsOptional()
  @IsUUID('4')
  recipientUserId?: string;

  @ApiPropertyOptional({ example: 'Gerente de categoría' })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  recipientRole?: string;

  @ApiProperty({ example: 'Nuevo precio propuesto' })
  @IsString()
  @MaxLength(200)
  title: string;

  @ApiProperty({ example: 'Presentación 500 g propuesta a $24.00.' })
  @IsString()
  message: string;

  @ApiProperty({ enum: PRIORIDADES, default: 'info' })
  @IsOptional()
  @IsIn(PRIORIDADES)
  priority?: Priority;
}
