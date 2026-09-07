import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsEmail,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

/**
 * Edición parcial: todos los campos son opcionales, pero se valida el
 * mismo formato que en el alta. `password` solo viaja cuando el
 * Administrador quiere restablecerla; si no se manda, la actual se
 * conserva intacta.
 */
export class UpdateUsuarioDto {
  @IsOptional()
  @IsString()
  @MinLength(3)
  @MaxLength(120)
  nombre?: string;

  @IsOptional()
  @IsEmail({}, { message: 'El correo electrónico no tiene un formato válido.' })
  @MaxLength(150)
  email?: string;

  @IsOptional()
  @IsString()
  @MinLength(8, { message: 'La contraseña debe tener al menos 8 caracteres.' })
  @Matches(/(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/, {
    message:
      'La contraseña debe incluir al menos una mayúscula, una minúscula y un número.',
  })
  password?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'Debes seleccionar un rol válido.' })
  @Min(1)
  rolId?: number;

  @IsOptional()
  @IsBoolean()
  activo?: boolean;
}
