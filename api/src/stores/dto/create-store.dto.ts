import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsNotEmpty, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

/** Valores reales del ENUM `formato_tienda` del esquema. */
export const FORMATOS_TIENDA = [
  'supermercado',
  'minimarket',
  'tienda_conveniencia',
  'mayorista',
  'otro',
] as const;

/**
 * M02 — Alta de tienda. Una tienda siempre nace con su dirección: no
 * tiene sentido registrar una sucursal sin domicilio, así que el DTO
 * pide los dos juntos y el service los crea en una sola transacción
 * (igual que M04 crea producto + primera presentación juntos).
 */
export class CreateStoreDto {
  @ApiProperty({ example: 'Super Valle Norte' })
  @IsString()
  @IsNotEmpty({ message: 'El nombre de la tienda es obligatorio.' })
  @MaxLength(150)
  nombre: string;

  @ApiProperty({ enum: FORMATOS_TIENDA, example: 'supermercado' })
  @IsIn(FORMATOS_TIENDA, { message: `formato debe ser uno de: ${FORMATOS_TIENDA.join(', ')}` })
  formato: (typeof FORMATOS_TIENDA)[number];

  @ApiProperty({ description: 'Id de una zona existente (M03).' })
  @IsUUID()
  zonaId: string;

  @ApiPropertyOptional({ example: 'SUC-004' })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  numeroSucursal?: string;

  @ApiPropertyOptional({ description: 'Id de un proveedor, si la tienda pertenece a uno.' })
  @IsOptional()
  @IsUUID()
  proveedorId?: string;

  // --- Dirección (se crea junto con la tienda) ---

  @ApiProperty({ example: 'Av. Insurgentes' })
  @IsString()
  @IsNotEmpty({ message: 'La calle es obligatoria.' })
  @MaxLength(150)
  calle: string;

  @ApiPropertyOptional({ example: '1200' })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  numeroExterior?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(20)
  numeroInterior?: string;

  @ApiPropertyOptional({ example: 'Del Valle' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  colonia?: string;

  @ApiProperty({
    example: '66220',
    description: 'Debe existir en el catálogo codigos_postales; si no, la API lo rechaza.',
  })
  @IsString()
  @IsNotEmpty({ message: 'El código postal es obligatorio.' })
  @MaxLength(10)
  codigoPostal: string;
}
