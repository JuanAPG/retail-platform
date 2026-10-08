import { NotificationsService } from './notifications.service';
import { InMemoryNotificationsRepository } from './in-memory.repository';
import { ROL } from '../common/roles';
import {
  EventType,
  SERVICIOS_EMISORES,
  atributosDe,
  esEventoSoportado,
  esServicioEmisor,
  permisoDe,
  permisos,
} from './notification.types';

function servicioFresco() {
  const repo = new InMemoryNotificationsRepository();
  const audit = { reportar: jest.fn().mockResolvedValue(undefined) };
  return { servicio: new NotificationsService(repo, audit as never), repo, audit };
}

/** Emisor válido para un evento: el rol que su regla permite. */
const emisorDe = (eventType: EventType) => ({
  usuarioId: 'emisor-1',
  rol: permisoDe(eventType).origenes[0],
  rolId: 1,
});

/** Un `precio.umbral` listo para usar: su destino es fijo (Responsable de precios). */
const UMBRAL = {
  eventType: 'precio.umbral' as const,
  sourceService: 'pricing-service' as const,
  title: 'Precio fuera de rango',
  message: 'La presentación 500 g quedó 30 % arriba de su zona.',
  priority: 'warning' as const,
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

  it('la lista de servicios emisores es cerrada', () => {
    expect(esServicioEmisor('pricing-service')).toBe(true);
    expect(esServicioEmisor('catalog-service')).toBe(true);
    // No emiten eventos de negocio y no deben colarse.
    expect(esServicioEmisor('auth-service')).toBe(false);
    expect(esServicioEmisor('notifications-service')).toBe(false);
    expect(esServicioEmisor('web')).toBe(false);
    expect(SERVICIOS_EMISORES).toHaveLength(8);
  });
});

describe('Tabla de permisos por evento', () => {
  it('todo evento soportado tiene una entrada con su fundamento', () => {
    for (const [evento, permiso] of Object.entries(permisos())) {
      expect(permiso.fundamento.length).toBeGreaterThan(20);
      expect(Array.isArray(permiso.origenes)).toBe(true);
      expect(['rol', 'usuario', 'pendiente']).toContain(permiso.destino.tipo);
      // Un destino de rol fijo tiene que nombrar un rol real.
      if (permiso.destino.tipo === 'rol') {
        expect(Object.values(ROL)).toContain(permiso.destino.rol);
      }
      expect(esEventoSoportado(evento)).toBe(true);
    }
  });

  it('las reglas acordadas con el equipo están como se acordaron', () => {
    expect(permisoDe('producto.propuesto')).toMatchObject({
      origenes: [ROL.PROVEEDOR],
      destino: { tipo: 'rol', rol: ROL.GERENTE_CATEGORIA },
    });
    expect(permisoDe('precio.umbral').origenes).toEqual([
      ROL.ADMINISTRADOR,
      ROL.RESPONSABLE_PRECIOS,
    ]);
    expect(permisoDe('recomendacion.resuelta').origenes).toEqual([ROL.GERENTE_CATEGORIA]);
  });

  it('los eventos sin flujo implementado no tienen origen: nadie los emite', () => {
    // No existe endpoint de solicitud de proveedor en ningún servicio, así
    // que no hay de dónde sacar el origen. Mejor que falle a que cualquiera
    // pueda inventarlos.
    expect(permisoDe('proveedor.solicitud').origenes).toEqual([]);
    expect(permisoDe('proveedor.resuelto').origenes).toEqual([]);
  });
});

describe('create: quién puede originar qué', () => {
  it('el rol permitido puede emitir', async () => {
    const { servicio } = servicioFresco();
    const r = await servicio.create(
      { ...UMBRAL, relatedEntityId: 'pr1', recipientRole: ROL.RESPONSABLE_PRECIOS },
      emisorDe('precio.umbral'),
    );
    expect(r.creada).toBe(true);
  });

  it('un Proveedor NO puede emitir precio.umbral a un Gerente (403)', async () => {
    // El caso exacto que QA reprodujo en vivo: un Proveedor mandaba una
    // notificación al rol Gerente de categoría y el Gerente la recibía.
    const { servicio, repo } = servicioFresco();
    await expect(
      servicio.create(
        { ...UMBRAL, relatedEntityId: 'pr2', recipientRole: ROL.GERENTE_CATEGORIA },
        { usuarioId: 'prov-1', rol: ROL.PROVEEDOR, rolId: 7 },
      ),
    ).rejects.toMatchObject({ status: 403 });

    // Y no quedó nada guardado.
    const { total } = await repo.listar({
      userId: 'x',
      rol: ROL.GERENTE_CATEGORIA,
      incluirArchivadas: true,
      skip: 0,
      limit: 10,
    });
    expect(total).toBe(0);
  });

  it('sin rol en el token no se puede emitir (403)', async () => {
    const { servicio } = servicioFresco();
    await expect(
      servicio.create(
        { ...UMBRAL, relatedEntityId: 'pr3', recipientRole: ROL.RESPONSABLE_PRECIOS },
        { usuarioId: 'u1' },
      ),
    ).rejects.toMatchObject({ status: 403 });
  });

  it('un evento sin regla de origen no se puede emitir, ni por un Admin (403)', async () => {
    const { servicio } = servicioFresco();
    await expect(
      servicio.create(
        {
          eventType: 'proveedor.solicitud',
          sourceService: 'catalog-service',
          title: 'Solicitud',
          message: 'Alta de proveedor.',
          recipientRole: ROL.ADMINISTRADOR,
        } as never,
        { usuarioId: 'a1', rol: ROL.ADMINISTRADOR, rolId: 1 },
      ),
    ).rejects.toMatchObject({ status: 403 });
  });

  it('rechaza un evento no soportado', async () => {
    const { servicio } = servicioFresco();
    await expect(
      servicio.create({ ...UMBRAL, eventType: 'otro' } as never, { rol: ROL.ADMINISTRADOR }),
    ).rejects.toMatchObject({ status: 400 });
  });
});

describe('create: el destinatario lo fija la regla, no el emisor', () => {
  const PROPUESTA = {
    eventType: 'producto.propuesto' as const,
    sourceService: 'catalog-service' as const,
    title: 'Nueva propuesta de producto',
    message: 'BioOrgánicos propuso Quinoa 500 g.',
  };

  it('destino de rol fijo: se asigna solo, sin que el emisor lo mande', async () => {
    const { servicio } = servicioFresco();
    const { data } = await servicio.create(
      { ...PROPUESTA, relatedEntityId: 'prod-1' },
      emisorDe('producto.propuesto'),
    );
    expect(data.recipientRole).toBe(ROL.GERENTE_CATEGORIA);
    expect(data.recipientUserId).toBeNull();
  });

  it('destino de rol fijo: rechaza dirigirlo a OTRO rol', async () => {
    const { servicio } = servicioFresco();
    await expect(
      servicio.create(
        { ...PROPUESTA, relatedEntityId: 'prod-2', recipientRole: ROL.AUDITOR },
        emisorDe('producto.propuesto'),
      ),
    ).rejects.toMatchObject({ status: 400 });
  });

  it('destino de rol fijo: rechaza dirigirlo a un usuario concreto', async () => {
    const { servicio } = servicioFresco();
    await expect(
      servicio.create(
        { ...PROPUESTA, relatedEntityId: 'prod-3', recipientUserId: 'u-cualquiera' },
        emisorDe('producto.propuesto'),
      ),
    ).rejects.toMatchObject({ status: 400 });
  });

  it('destino de usuario: exige recipientUserId y no acepta rol', async () => {
    const { servicio } = servicioFresco();
    const RESUELTA = {
      eventType: 'propuesta.resuelta' as const,
      sourceService: 'catalog-service' as const,
      title: 'Tu propuesta fue resuelta',
      message: 'Quinoa 500 g fue aprobada.',
    };

    await expect(
      servicio.create({ ...RESUELTA, relatedEntityId: 'prod-4' }, emisorDe('propuesta.resuelta')),
    ).rejects.toMatchObject({ status: 400 });

    const { data } = await servicio.create(
      { ...RESUELTA, relatedEntityId: 'prod-5', recipientUserId: 'prov-7' },
      emisorDe('propuesta.resuelta'),
    );
    expect(data.recipientUserId).toBe('prov-7');
    expect(data.recipientRole).toBeNull();
  });

  it('destino fijo a rol: no hace falta que el emisor mande destinatario', async () => {
    const { servicio } = servicioFresco();
    const { data } = await servicio.create(
      { ...UMBRAL, relatedEntityId: 'pr4' },
      emisorDe('precio.umbral'),
    );
    expect(data.recipientRole).toBe(ROL.RESPONSABLE_PRECIOS);
    expect(data.recipientUserId).toBeNull();
  });

  it('destino dinámico (escenario.generado): vuelve a quien lo generó', async () => {
    const { servicio } = servicioFresco();
    const ESCENARIO = {
      eventType: 'escenario.generado' as const,
      sourceService: 'decision-service' as const,
      title: 'Nuevo escenario',
      message: 'Escenario de precios generado.',
    };

    await expect(
      servicio.create({ ...ESCENARIO, relatedEntityId: 'esc-0' }, emisorDe('escenario.generado')),
    ).rejects.toMatchObject({ status: 400 });

    const { data } = await servicio.create(
      { ...ESCENARIO, relatedEntityId: 'esc-1', recipientUserId: 'analista-7' },
      emisorDe('escenario.generado'),
    );
    expect(data.recipientUserId).toBe('analista-7');
    expect(data.recipientRole).toBeNull();
  });
});

describe('create: sourceService', () => {
  it('se guarda lo que manda el emisor (antes quedaba siempre null)', async () => {
    const { servicio } = servicioFresco();
    const { data } = await servicio.create(
      { ...UMBRAL, relatedEntityId: 'pr5', recipientRole: ROL.RESPONSABLE_PRECIOS },
      emisorDe('precio.umbral'),
    );
    expect(data.sourceService).toBe('pricing-service');
  });

  it('la auditoría registra el servicio y el rol de origen', async () => {
    const { servicio, audit } = servicioFresco();
    await servicio.create(
      { ...UMBRAL, relatedEntityId: 'pr6', recipientRole: ROL.RESPONSABLE_PRECIOS },
      emisorDe('precio.umbral'),
    );
    expect(audit.reportar).toHaveBeenCalledWith(
      expect.objectContaining({
        tabla: 'notificaciones',
        accion: 'insert',
        cambios: expect.arrayContaining([
          { campo: 'sourceService', posterior: 'pricing-service' },
          { campo: 'rolOrigen', posterior: ROL.ADMINISTRADOR },
        ]),
      }),
      undefined, // emisorDe() no manda token: nada que reenviar.
    );
  });
});

describe('markAsRead y lectura por id: solo el destinatario', () => {
  /** Una notificación dirigida al rol Gerente de categoría. */
  async function paraElGerente() {
    const ctx = servicioFresco();
    const { data } = await ctx.servicio.create(
      {
        eventType: 'producto.propuesto',
        sourceService: 'catalog-service',
        title: 'Nueva propuesta',
        message: 'Propuesta de producto.',
        relatedEntityId: 'prod-9',
      } as never,
      emisorDe('producto.propuesto'),
    );
    return { ...ctx, notificacion: data };
  }

  it('el destinatario por ROL la lee y la marca', async () => {
    const { servicio, notificacion } = await paraElGerente();
    const vista = await servicio.findOneForUser(notificacion.id, {
      id: 'g1',
      rol: ROL.GERENTE_CATEGORIA,
    });
    expect(vista.id).toBe(notificacion.id);

    const leida = await servicio.markAsRead(notificacion.id, {
      id: 'g1',
      rol: ROL.GERENTE_CATEGORIA,
    });
    expect(leida.readBy).toMatchObject([{ userId: 'g1' }]);
  });

  it('un ajeno NO la marca y NO recibe el contenido (404)', async () => {
    // El caso exacto que QA reprodujo: el Proveedor B marcaba como leída la
    // del Gerente y la respuesta le devolvía el contenido.
    const { servicio, notificacion } = await paraElGerente();

    await expect(
      servicio.markAsRead(notificacion.id, { id: 'prov-b', rol: ROL.PROVEEDOR }),
    ).rejects.toMatchObject({ status: 404 });

    await expect(
      servicio.findOneForUser(notificacion.id, { id: 'prov-b', rol: ROL.PROVEEDOR }),
    ).rejects.toMatchObject({ status: 404 });
  });

  it('el intento ajeno no deja marca de lectura', async () => {
    const { servicio, notificacion } = await paraElGerente();
    await expect(
      servicio.markAsRead(notificacion.id, { id: 'prov-b', rol: ROL.PROVEEDOR }),
    ).rejects.toThrow();

    const vista = await servicio.findOneForUser(notificacion.id, {
      id: 'g1',
      rol: ROL.GERENTE_CATEGORIA,
    });
    expect(vista.readBy).toEqual([]);
  });

  it('404 con el MISMO mensaje que una inexistente: no delata que existe', async () => {
    const { servicio, notificacion } = await paraElGerente();
    const ajena = await servicio
      .markAsRead(notificacion.id, { id: 'prov-b', rol: ROL.PROVEEDOR })
      .catch((e: Error) => e.message);
    const inexistente = await servicio
      .markAsRead('00000000-0000-4000-8000-000000000000', { id: 'prov-b', rol: ROL.PROVEEDOR })
      .catch((e: Error) => e.message);
    expect(ajena).toBe(inexistente);
  });

  it('el destinatario por USUARIO la marca; otro usuario no', async () => {
    const { servicio } = servicioFresco();
    const { data } = await servicio.create(
      {
        eventType: 'propuesta.resuelta',
        sourceService: 'catalog-service',
        title: 'Resuelta',
        message: 'Aprobada.',
        relatedEntityId: 'prod-10',
        recipientUserId: 'prov-a',
      } as never,
      emisorDe('propuesta.resuelta'),
    );

    await expect(
      servicio.markAsRead(data.id, { id: 'prov-b', rol: ROL.PROVEEDOR }),
    ).rejects.toMatchObject({ status: 404 });

    const leida = await servicio.markAsRead(data.id, { id: 'prov-a', rol: ROL.PROVEEDOR });
    expect(leida.readBy).toMatchObject([{ userId: 'prov-a' }]);
  });

  it('tener el rol correcto no alcanza si va dirigida a un usuario', async () => {
    const { servicio } = servicioFresco();
    const { data } = await servicio.create(
      {
        eventType: 'propuesta.resuelta',
        sourceService: 'catalog-service',
        title: 'Resuelta',
        message: 'Aprobada.',
        relatedEntityId: 'prod-11',
        recipientUserId: 'prov-a',
      } as never,
      emisorDe('propuesta.resuelta'),
    );
    await expect(
      servicio.markAsRead(data.id, { id: 'otro', rol: ROL.PROVEEDOR }),
    ).rejects.toMatchObject({ status: 404 });
  });

  it('una notificación que no existe da 404', async () => {
    const { servicio } = servicioFresco();
    await expect(
      servicio.markAsRead('00000000-0000-4000-8000-000000000000', { id: 'u1', rol: ROL.AUDITOR }),
    ).rejects.toMatchObject({ status: 404 });
  });
});

describe('Reglas que ya estaban y siguen valiendo', () => {
  // `escenario.generado` tiene destino dinámico (vuelve a quien lo lanzó):
  // sirve de fixture para la mecánica genérica de dedup/lectura/archivado
  // por `recipientUserId`, ya que `precio.umbral` ahora va a un rol fijo.
  const ESCENARIO = {
    eventType: 'escenario.generado' as const,
    sourceService: 'decision-service' as const,
    title: 'Nuevo escenario',
    message: 'Escenario de precios generado.',
  };

  it('no duplica en 5 minutos (responde la existente)', async () => {
    const { servicio } = servicioFresco();
    const primera = await servicio.create(
      { ...ESCENARIO, relatedEntityId: 'p1', recipientUserId: 'u1' },
      emisorDe('escenario.generado'),
    );
    expect(primera.creada).toBe(true);
    const segunda = await servicio.create(
      { ...ESCENARIO, relatedEntityId: 'p1', recipientUserId: 'u1' },
      emisorDe('escenario.generado'),
    );
    expect(segunda.creada).toBe(false);
    expect(segunda.data.id).toBe(primera.data.id);
  });

  it('mismo evento para OTRO destinatario sí crea (no pierde avisos)', async () => {
    const { servicio } = servicioFresco();
    const paraU1 = await servicio.create(
      { ...ESCENARIO, relatedEntityId: 'p1x', recipientUserId: 'u1' },
      emisorDe('escenario.generado'),
    );
    const paraU2 = await servicio.create(
      { ...ESCENARIO, relatedEntityId: 'p1x', recipientUserId: 'u2' },
      emisorDe('escenario.generado'),
    );
    expect(paraU2.creada).toBe(true);
    expect(paraU2.data.id).not.toBe(paraU1.data.id);
    expect(await servicio.countUnread('u2')).toEqual({ unread: 1 });
  });

  it('lectura por usuario en readBy, nunca global', async () => {
    const { servicio } = servicioFresco();
    const { data: creada } = await servicio.create(
      { ...ESCENARIO, relatedEntityId: 'p3', recipientUserId: 'u1' },
      emisorDe('escenario.generado'),
    );
    expect(await servicio.countUnread('u2')).toEqual({ unread: 0 });
    expect(await servicio.countUnread('u1')).toEqual({ unread: 1 });
    const leida = await servicio.markAsRead(creada.id, { id: 'u1', rol: ROL.ANALISTA });
    expect(leida.readBy).toMatchObject([{ userId: 'u1' }]);
    expect(await servicio.countUnread('u1')).toEqual({ unread: 0 });
  });

  it('por rol: la ve quien tenga el rol y cuenta hasta leerla', async () => {
    const { servicio } = servicioFresco();
    await servicio.create(
      { ...UMBRAL, relatedEntityId: 'p4', recipientRole: ROL.RESPONSABLE_PRECIOS },
      emisorDe('precio.umbral'),
    );
    expect(await servicio.countUnread('u9', ROL.RESPONSABLE_PRECIOS)).toEqual({ unread: 1 });
    expect(await servicio.countUnread('u9', ROL.AUDITOR)).toEqual({ unread: 0 });
  });

  it('archiva lo mayor a 90 días sin eliminar', async () => {
    const { servicio, repo } = servicioFresco();
    await servicio.create(
      { ...ESCENARIO, relatedEntityId: 'p5', recipientUserId: 'u1' },
      emisorDe('escenario.generado'),
    );
    const vieja = await repo.crear({
      eventType: 'precio.propuesto',
      sourceService: 'pricing-service',
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
      { ...ESCENARIO, relatedEntityId: 'p7', recipientUserId: 'u1' },
      { ...emisorDe('escenario.generado'), token: 'Bearer t-1' },
    );
    expect(audit.reportar).toHaveBeenCalledWith(
      expect.objectContaining({ tabla: 'notificaciones', accion: 'insert' }),
      'Bearer t-1',
    );
  });
});
