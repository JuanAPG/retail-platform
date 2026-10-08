import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Min,
  ValidatorConstraint,
  ValidatorConstraintInterface,
  Validate,
  ValidationArguments,
} from 'class-validator';
import { PaginationDto } from '../../common/dto/pagination.dto';
import { ESTADO_REPORTE } from '../schemas/report.schema';

const FECHA = /^\d{4}-\d{2}-\d{2}$/;

@ValidatorConstraint({ name: 'rangoValido', async: false })
class RangoValido implements ValidatorConstraintInterface {
  validate(dateTo: string, args: ValidationArguments) {
    const { dateFrom } = args.object as { dateFrom?: string };
    return !dateFrom || !dateTo || dateFrom <= dateTo;
  }
  defaultMessage() {
    return 'dateFrom no puede ser posterior a dateTo';
  }
}

/** Cuerpo de `POST /v1/reports/executive`. */
export class GenerarReporteEjecutivoDto {
  @Matches(FECHA, { message: 'dateFrom debe ser YYYY-MM-DD' })
  dateFrom!: string;

  @Matches(FECHA, { message: 'dateTo debe ser YYYY-MM-DD' })
  @Validate(RangoValido)
  dateTo!: string;

  @IsOptional()
  @IsUUID()
  zoneId?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  segmentId?: number;
}

/** Query de `GET /v1/reports`. */
export class ListarReportesDto extends PaginationDto {
  @IsOptional()
  @IsString()
  usuarioId?: string;

  @IsOptional()
  @IsString()
  tipo?: string;

  @IsOptional()
  @Matches(FECHA, { message: 'dateFrom debe ser YYYY-MM-DD' })
  dateFrom?: string;

  @IsOptional()
  @Matches(FECHA, { message: 'dateTo debe ser YYYY-MM-DD' })
  dateTo?: string;
}

/** Cuerpo de `PATCH /v1/reports/:id`. */
export class ActualizarReporteDto {
  @IsIn(Object.values(ESTADO_REPORTE))
  estado!: string;
}

/** Query de `GET /v1/reports/:id/export`. */
export class ExportarReporteDto {
  // D-19: el PDF es obligatorio; Excel (xlsx) queda para después si da tiempo.
  @IsIn(['pdf'], { message: 'format debe ser pdf (xlsx aún no está disponible)' })
  format!: string;
}
