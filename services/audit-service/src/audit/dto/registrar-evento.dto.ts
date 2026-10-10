import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsIP,
  IsOptional,
  IsString,
  MaxLength,
  Validate,
  ValidateNested,
  ValidationArguments,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from 'class-validator';
import { AccionAuditoria } from '../../entities/auditoria.entity';

export const ACCIONES: AccionAuditoria[] = [
  'insert',
  'update',
  'delete',
  'login',
  'importacion',
  'aprobar',
  'rechazar',
  'desactivar',
  'ejecutar_corrida',
  'simular',
  'generar_recomendacion',
  'exportar',
];

/**
 * Topes de longitud. Los de 80 NO son un criterio estético: son el ancho
 * exacto de `auditoria.tabla_afectada` y `auditoria_cambios.campo`
 * (`VARCHAR(80)` en db/schema.sql §15). Sin ellos el valor pasa la
 * validación y revienta en Postgres, y el emisor recibe un 500 en vez del
 * 400 que le corresponde.
 *
 * `descripcion`, `registro_id`, `valor_previo` y `valor_posterior` son
 * TEXT (sin tope en la base), así que el tope lo pone la API: la bitácora
 * es append-only y no hay forma de borrar lo que se escriba de más.
 */
export const LARGO = {
  /** Ancho de la columna `tabla_afectada`. */
  TABLA: 80,
  /** Ancho de la columna `campo`. */
  CAMPO: 80,
  /** UUID (36), ObjectId de Mongo (24) o id numérico caben de sobra. */
  REGISTRO_ID: 200,
  /** Una descripción de bitácora es una frase, no un documento. */
  DESCRIPCION: 1000,
  /** Valor de un campo auditado, no un archivo. */
  VALOR: 2000,
} as const;

/**
 * `auditoria_cambios` tiene `PRIMARY KEY (auditoria_id, campo)`: un evento
 * registra UN antes/después por campo. Dos entradas del mismo campo en el
 * mismo evento son un error del emisor, y aceptarlas no es opción —
 * `save()` intentaría dos INSERT con la misma clave y Postgres responde
 * `duplicate key`, que el cliente ve como 500. Se rechaza con 400 y un
 * mensaje que dice qué campo viene repetido.
 */
@ValidatorConstraint({ name: 'camposUnicos' })
export class CamposUnicosConstraint implements ValidatorConstraintInterface {
  validate(cambios: unknown): boolean {
    if (!Array.isArray(cambios)) return true;
    const campos = cambios
      .map((cambio) => (cambio as CambioDto | null)?.campo)
      .filter((campo): campo is string => typeof campo === 'string');
    return new Set(campos).size === campos.length;
  }

  defaultMessage(args: ValidationArguments): string {
    const campos = Array.isArray(args.value)
      ? (args.value as CambioDto[]).map((cambio) => cambio?.campo)
      : [];
    const repetidos = [...new Set(campos.filter((campo, i) => campos.indexOf(campo) !== i))];
    return `cambios no puede repetir el mismo campo en un evento (repetido: ${repetidos.join(', ')}). Un evento registra un antes/después por campo; si hubo dos cambios, son dos eventos.`;
  }
}

export class CambioDto {
  @IsString()
  @MaxLength(LARGO.CAMPO, { message: `campo no puede tener más de ${LARGO.CAMPO} caracteres.` })
  campo: string;

  @IsOptional()
  @IsString()
  @MaxLength(LARGO.VALOR, { message: `previo no puede tener más de ${LARGO.VALOR} caracteres.` })
  previo?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(LARGO.VALOR, { message: `posterior no puede tener más de ${LARGO.VALOR} caracteres.` })
  posterior?: string | null;
}

/**
 * Evento que reporta otro microservicio. `tabla`, `servicio` y `accion`
 * son obligatorios: un evento sin ellos no dice quién reportó qué.
 *
 * `usuarioId` y `rolId` NO están aquí a propósito: el actor SIEMPRE sale
 * del token verificado por `SessionGuard` en el controller, nunca del
 * cuerpo (`forbidNonWhitelisted` responde 400 si alguien los manda,
 * para no poder falsificar quién hizo qué).
 */
export class RegistrarEventoDto {
  @IsString()
  @MaxLength(LARGO.TABLA, { message: `tabla no puede tener más de ${LARGO.TABLA} caracteres.` })
  tabla: string;

  @IsOptional()
  @IsString()
  @MaxLength(LARGO.REGISTRO_ID, {
    message: `registroId no puede tener más de ${LARGO.REGISTRO_ID} caracteres.`,
  })
  registroId?: string;

  /** Nombre del microservicio emisor, p. ej. `pricing-service`. */
  @IsString()
  @MaxLength(40, { message: 'servicio no puede tener más de 40 caracteres.' })
  servicio: string;

  @IsIn(ACCIONES, {
    message: `accion debe ser una de: ${ACCIONES.join(', ')}.`,
  })
  accion: AccionAuditoria;

  @IsOptional()
  @IsString()
  @MaxLength(LARGO.DESCRIPCION, {
    message: `descripcion no puede tener más de ${LARGO.DESCRIPCION} caracteres.`,
  })
  descripcion?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @Validate(CamposUnicosConstraint)
  @ValidateNested({ each: true })
  @Type(() => CambioDto)
  cambios?: CambioDto[];

  /**
   * `direccion_ip` es `INET`: un texto que no sea una IP revienta en
   * Postgres (`invalid input syntax for type inet`) y el emisor recibe un
   * 500. `@IsIP()` acepta IPv4, IPv6 y la forma IPv4 mapeada que mandan
   * los reporteros detrás de Docker (`::ffff:172.18.0.1`).
   */
  @IsOptional()
  @IsIP(undefined, { message: 'ip debe ser una dirección IPv4 o IPv6 válida.' })
  ip?: string;
}
