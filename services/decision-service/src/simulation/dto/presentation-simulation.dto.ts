import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ArrayMinSize, ArrayUnique, IsArray, IsOptional, IsUUID } from 'class-validator';

/**
 * D-14: se comparan TODAS las presentaciones de UN solo producto (Arroz
 * 250 g / 500 g / 1 kg), nunca productos distintos ni sustitutos. Por eso
 * la entrada lleva un único `productId` y no uno por presentación.
 */
export class PresentationSimulationDto {
  @ApiProperty({ description: 'UUID del producto cuyas presentaciones se comparan' })
  @IsUUID(undefined, { message: 'productId debe ser un UUID válido.' })
  productId: string;

  @ApiPropertyOptional({
    description: 'UUID de zona para tomar precio/demanda local; si se omite, usa datos nacionales',
  })
  @IsOptional()
  @IsUUID(undefined, { message: 'zoneId debe ser un UUID válido.' })
  zoneId?: string;

  @ApiPropertyOptional({
    type: [String],
    description:
      'Presentaciones a comparar (2 o más, todas del producto). Si se omite, se usan todas las activas del producto.',
  })
  @IsOptional()
  @IsArray({ message: 'presentationIds debe ser una lista de UUID.' })
  @ArrayMinSize(2, { message: 'presentationIds debe traer al menos 2 presentaciones.' })
  @ArrayUnique((id: unknown) => (typeof id === 'string' ? id.toLowerCase() : id), {
    message: 'presentationIds no debe repetir presentaciones.',
  })
  @IsUUID(undefined, { each: true, message: 'Cada elemento de presentationIds debe ser un UUID válido.' })
  presentationIds?: string[];
}
