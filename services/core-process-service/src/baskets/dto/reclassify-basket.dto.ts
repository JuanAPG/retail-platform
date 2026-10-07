import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsBoolean, IsOptional } from 'class-validator';

/** M07 — Opciones de la reclasificación de UNA canasta. */
export class ReclassifyBasketDto {
  @ApiPropertyOptional({
    default: false,
    description:
      'Vuelve a derivar la zona desde la tienda de su transacción. Por defecto `false`: la ' +
      'zona se congela al construir la canasta a propósito (RN-02), y re-derivarla ' +
      'reescribiría el análisis de meses pasados si la tienda cambió de zona. Usar solo para ' +
      'corregir una canasta cuya zona quedó mal.',
  })
  @IsOptional()
  // `Boolean('false')` es `true`: hay que mapear a mano. Cualquier otro
  // texto queda sin convertir para que `@IsBoolean` lo rechace con 400.
  @Transform(({ value }) =>
    value === 'true' || value === true ? true : value === 'false' || value === false ? false : value,
  )
  @IsBoolean({ message: 'resyncZone debe ser true o false.' })
  resyncZone?: boolean;
}
