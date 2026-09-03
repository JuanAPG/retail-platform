import {
  IsEmail,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

/**
 * Corresponde a la pantalla "Registro de proveedor" del wireframe:
 * único flujo de auto-registro del sistema (los roles internos los
 * crea el Administrador desde el Portal Admin, no se auto-registran).
 */
export class RegisterProveedorDto {
  @IsString()
  @MinLength(3)
  @MaxLength(120)
  nombreContacto: string;

  @IsString()
  @MinLength(3)
  @MaxLength(150)
  razonSocial: string;

  @IsString()
  @Matches(/^[A-ZÑ&]{3,4}\d{6}[A-Z0-9]{3}$/, {
    message: 'El RFC no tiene un formato válido (ej. XAXX010101000).',
  })
  rfc: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  telefono?: string;

  @IsEmail({}, { message: 'El correo electrónico no tiene un formato válido.' })
  email: string;

  @IsString()
  @MinLength(8, { message: 'La contraseña debe tener al menos 8 caracteres.' })
  @Matches(/(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/, {
    message:
      'La contraseña debe incluir al menos una mayúscula, una minúscula y un número.',
  })
  password: string;
}
