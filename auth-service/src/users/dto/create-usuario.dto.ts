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
 * Alta de usuario hecha por el Administrador desde el Portal Admin.
 * A diferencia del auto-registro de proveedor, aquí SÍ se elige el rol
 * y la cuenta puede nacer activa.
 */
export class CreateUsuarioDto {
  @IsString()
  @MinLength(3)
  @MaxLength(120)
  nombre: string;

  @IsEmail({}, { message: 'El correo electrónico no tiene un formato válido.' })
  @MaxLength(150)
  email: string;

  @IsString()
  @MinLength(8, { message: 'La contraseña debe tener al menos 8 caracteres.' })
  @Matches(/(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/, {
    message:
      'La contraseña debe incluir al menos una mayúscula, una minúscula y un número.',
  })
  password: string;

  @Type(() => Number)
  @IsInt({ message: 'Debes seleccionar un rol válido.' })
  @Min(1)
  rolId: number;

  @IsOptional()
  @IsBoolean()
  activo?: boolean;
}
