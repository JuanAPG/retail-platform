import { ValidatorConstraint, ValidatorConstraintInterface } from 'class-validator';
import { esFechaFutura, parsearFecha } from '../fecha.util';

/**
 * M06 — Una venta no puede estar fechada en el futuro. El camino CSV ya lo
 * rechazaba con el código `FECHA_FUTURA`; esto cierra la misma regla en el
 * alta manual, que antes la aceptaba.
 */
@ValidatorConstraint({ name: 'noEsFechaFutura', async: false })
export class NoEsFechaFutura implements ValidatorConstraintInterface {
  validate(valor: unknown): boolean {
    if (typeof valor !== 'string') return false;
    const fecha = parsearFecha(valor);
    // Una fecha ilegible ya la rechaza @IsDateString: aquí no se duplica
    // el error.
    if (!fecha) return true;
    return !esFechaFutura(fecha);
  }

  defaultMessage(): string {
    return 'fecha no puede ser futura.';
  }
}
