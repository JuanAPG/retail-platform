import { CallHandler, ExecutionContext, Injectable, NestInterceptor, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { DataSource } from 'typeorm';
import { Observable, from } from 'rxjs';
import { mergeMap } from 'rxjs/operators';
import { NotificationsReporter } from './notifications-reporter.service';

export type MomentoProducto = 'propuesto' | 'resuelto';
export const NOTIFICAR_KEY = 'notificar';

/**
 * Avisos del alta de producto por un Proveedor (CAT-09), sobre el contrato de notifications-service:
 *
 * - `propuesto` → `producto.propuesto`, que el receptor entrega al rol Gerente de categoría.
 * - `resuelto`  → `propuesta.resuelta`, al USUARIO que propuso (el Proveedor), con el motivo si se rechazó.
 *
 * Es no bloqueante: solo corre si la operación tuvo éxito y un fallo del receptor no la rompe.
 * Un producto sin proveedor (alta directa del Gerente) no genera aviso de resolución.
 * Nota: el contrato de notificaciones no define un destino "Auditor" para estos eventos.
 */
export const NotificarProducto = (momento: MomentoProducto) => SetMetadata(NOTIFICAR_KEY, momento);

@Injectable()
export class NotificarInterceptor implements NestInterceptor {
  constructor(
    private readonly reflector: Reflector,
    private readonly dataSource: DataSource,
    private readonly notificaciones: NotificationsReporter,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const momento = this.reflector.get<MomentoProducto | undefined>(NOTIFICAR_KEY, context.getHandler());
    if (!momento) return next.handle();
    const req = context.switchToHttp().getRequest<{ headers: Record<string, string | undefined>; body?: Record<string, unknown> }>();

    return next.handle().pipe(
      mergeMap((respuesta) => from(this.avisar(momento, respuesta as ProductoRespuesta, req).then(() => respuesta))),
    );
  }

  private async avisar(
    momento: MomentoProducto,
    producto: ProductoRespuesta,
    req: { headers: Record<string, string | undefined>; body?: Record<string, unknown> },
  ) {
    try {
      if (!producto?.id) return;
      const token = req.headers['authorization'];

      if (momento === 'propuesto') {
        await this.notificaciones.emitir(
          {
            eventType: 'producto.propuesto',
            relatedEntityType: 'producto',
            relatedEntityId: producto.id,
            title: 'Nueva propuesta de producto',
            message: `${producto.proveedor?.razonSocial ?? 'Un proveedor'} propuso "${producto.nombre}" (${producto.sku}).`,
          },
          token,
        );
        return;
      }

      // Resuelto: el aviso va al usuario que propuso; el vínculo proveedor-usuario es el correo.
      const [dueno] = await this.dataSource.query(
        `SELECT u.id FROM productos p
         JOIN proveedores pr ON pr.id = p.proveedor_id
         JOIN usuarios u ON u.email = pr.email
         WHERE p.id = $1`,
        [producto.id],
      );
      if (!dueno) return;
      const aprobado = producto.estatus === 'activo';
      const motivo = !aprobado && typeof req.body?.motivoRechazo === 'string' ? ` Motivo: ${req.body.motivoRechazo}` : '';
      await this.notificaciones.emitir(
        {
          eventType: 'propuesta.resuelta',
          relatedEntityType: 'producto',
          relatedEntityId: producto.id,
          title: aprobado ? 'Tu propuesta de producto fue aprobada' : 'Tu propuesta de producto fue rechazada',
          message: `"${producto.nombre}" (${producto.sku}) fue ${aprobado ? 'aprobado' : 'rechazado'}.${motivo}`,
          priority: aprobado ? 'info' : 'warning',
          recipientUserId: dueno.id,
        },
        token,
      );
    } catch {
      // Un aviso fallido nunca rompe la operación.
    }
  }
}

interface ProductoRespuesta {
  id?: string;
  sku?: string;
  nombre?: string;
  estatus?: string;
  proveedor?: { razonSocial?: string } | null;
}
