import { NotificationsService } from './notifications.service';
import { InMemoryNotificationsRepository } from './in-memory.repository';
import { atributosDe, esEventoSoportado } from './notification.types';

function servicio() {
  const repo = new InMemoryNotificationsRepository();
  const audit = { reportar: jest.fn().mockResolvedValue(undefined) };
  return { servicio: new NotificationsService(repo, audit as never), repo, audit };
}

const BASE = {
  eventType: 'precio.propuesto',
  title: 'Nuevo precio propuesto',
  message: 'Presentación 500 g a $24.00.',
  priority: 'info' as const,
};

describe('Matriz de eventos', () => {
  it('resuelve atributos por tipo y rechaza desconocidos', () => {
    expect(esEventoSoportado('precio.propuesto')).toBe(true);
    expect(esEventoSoportado('inexistente')).toBe(false);
    expect(atributosDe('precio.umbral')).toMatchObject({
      priority: 'warning',
      relatedEntityType: 'presentacion',
    });
  });
});

describe('NotificationsService (sin Mongo)', () => {
  it('crea y no duplica en 5 minutos (responde la existente)', async () => {
    const { servicio } = servicioFresco();
    const primera = await servicio.create(
      { ...BASE, relatedEntityId: 'p1', recipientUserId: 'u1' },
      { servicio: 'pricing-service' },
    );
    expect(primera.creada).toBe(true);
    const segunda = await servicio.create(
      { ...BASE, relatedEntityId: 'p1', recipientUserId: 'u1' },
      { servicio: 'pricing-service' },
    );
    expect(segunda.creada).toBe(false);
    expect(segunda.data.id).toBe(primera.data.id);
  });

  it('mismo evento para OTRO destinatario sí crea (no pierde avisos)', async () => {
    const { servicio } = servicioFresco();
    const paraU1 = await servicio.create(
      { ...BASE, relatedEntityId: 'p1x', recipientUserId: 'u1' },
      { servicio: 'pricing-service' },
    );
    const paraU2 = await servicio.create(
      { ...BASE, relatedEntityId: 'p1x', recipientUserId: 'u2' },
      { servicio: 'pricing-service' },
    );
    expect(paraU2.creada).toBe(true);
    expect(paraU2.data.id).not.toBe(paraU1.data.id);
    expect(await servicio.countUnread('u2')).toEqual({ unread: 1 });
  });

  it('rechaza evento no soportado y sin destinatario', async () => {
    const { servicio } = servicioFresco();
    await expect(servicio.create({ ...BASE, eventType: 'otro' } as never, {})).rejects.toThrow();
    await expect(
      servicio.create({ ...BASE, relatedEntityId: 'p2' }, {}),
    ).rejects.toThrow();
  });

  it('lectura por usuario en readBy, nunca global', async () => {
    const { servicio } = servicioFresco();
    const { data: creada } = await servicio.create(
      { ...BASE, relatedEntityId: 'p3', recipientUserId: 'u1' },
      {},
    );
    // Otro usuario no la ve en su conteo.
    expect(await servicio.countUnread('u2')).toEqual({ unread: 0 });
    expect(await servicio.countUnread('u1')).toEqual({ unread: 1 });
    const leida = await servicio.markAsRead(creada.id, 'u1');
    expect(leida.readBy).toMatchObject([{ userId: 'u1' }]);
    expect(await servicio.countUnread('u1')).toEqual({ unread: 0 });
  });

  it('por rol: la ve quien tenga el rol y cuenta hasta leerla', async () => {
    const { servicio } = servicioFresco();
    await servicio.create(
      { ...BASE, relatedEntityId: 'p4', recipientRole: 'Gerente de categoría' },
      {},
    );
    expect(await servicio.countUnread('u9', 'Gerente de categoría')).toEqual({ unread: 1 });
    expect(await servicio.countUnread('u9', 'Auditor')).toEqual({ unread: 0 });
  });

  it('archiva lo mayor a 90 días sin eliminar', async () => {
    const { servicio, repo } = servicioFresco();
    await servicio.create({ ...BASE, relatedEntityId: 'p5', recipientUserId: 'u1' }, {});
    const vieja = await repo.crear({
      eventType: 'precio.propuesto',
      sourceService: null,
      recipientUserId: 'u1',
      recipientRole: null,
      title: 'Vieja',
      message: 'Vieja.',
      relatedEntityType: 'presentacion',
      relatedEntityId: 'p6',
      priority: 'info',
    });
    vieja.createdAt = new Date(Date.now() - 91 * 86400000);
    await servicio.archivarViejas();
    const { total } = await repo.listar({
      userId: 'u1',
      incluirArchivadas: true,
      skip: 0,
      limit: 10,
    });
    expect(total).toBe(2); // archivada sigue existiendo
    expect(await servicio.countUnread('u1')).toEqual({ unread: 1 });
  });

  it('cada creación reporta a auditoría sin bloquear, reenviando el token del emisor', async () => {
    const { servicio, audit } = servicioFresco();
    await servicio.create(
      { ...BASE, relatedEntityId: 'p7', recipientUserId: 'u1' },
      { token: 'Bearer t-1' },
    );
    expect(audit.reportar).toHaveBeenCalledWith(
      expect.objectContaining({ tabla: 'notificaciones', accion: 'insert' }),
      'Bearer t-1',
    );
  });

  function servicioFresco() {
    return servicio();
  }
});
