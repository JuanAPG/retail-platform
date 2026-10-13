import { Logger } from '@nestjs/common';
import { NotificationsReporter } from './notifications-reporter.service';

const AVISO = {
  evento: 'recomendacion.resuelta' as const,
  recipientRole: 'Planeador',
  payload: { relatedEntityId: 'rec-1', title: 'Recomendación resuelta', message: 'Recomendación rec-1 aprobada.' },
};

/** Los avisos a notifications-service nunca rompen la operación que los origina. Sin red: `fetch` va simulado. */
describe('NotificationsReporter de decision-service (fire-and-forget)', () => {
  const urlOriginal = process.env.NOTIFICATIONS_SERVICE_URL;
  const fetchOriginal = global.fetch;
  let fetchMock: jest.Mock;
  let avisos: string[];

  beforeEach(() => {
    process.env.NOTIFICATIONS_SERVICE_URL = 'http://notifications-service:3109';
    fetchMock = jest.fn(async () => ({ ok: true, status: 201 }));
    global.fetch = fetchMock as unknown as typeof fetch;
    avisos = [];
    jest.spyOn(Logger.prototype, 'warn').mockImplementation((m: unknown) => {
      avisos.push(String(m));
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
    global.fetch = fetchOriginal;
    if (urlOriginal === undefined) delete process.env.NOTIFICATIONS_SERVICE_URL;
    else process.env.NOTIFICATIONS_SERVICE_URL = urlOriginal;
  });

  it('manda POST /v1/notifications con los campos del contrato y reenvía el Authorization del usuario', async () => {
    await new NotificationsReporter().notificar(AVISO, { token: 'tok' });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, opciones] = fetchMock.mock.calls[0];
    expect(url).toBe('http://notifications-service:3109/v1/notifications');
    expect(opciones.method).toBe('POST');
    expect(opciones.headers).toEqual({ 'Content-Type': 'application/json', Authorization: 'Bearer tok' });
    // Cuerpo exacto: el receptor rechaza (400) cualquier campo fuera de su DTO.
    expect(JSON.parse(opciones.body)).toEqual({
      eventType: 'recomendacion.resuelta',
      sourceService: 'decision-service',
      relatedEntityType: 'recomendacion',
      relatedEntityId: 'rec-1',
      recipientRole: 'Planeador',
      title: 'Recomendación resuelta',
      message: 'Recomendación rec-1 aprobada.',
      priority: 'info',
    });
    expect(avisos).toEqual([]);
  });

  it('destino de usuario: manda recipientUserId y no recipientRole; el escenario va como entidad "escenario"', async () => {
    await new NotificationsReporter().notificar(
      { evento: 'escenario.generado', recipientUserId: 'u-1', payload: { relatedEntityId: 'esc-1', title: 't', message: 'm' } },
      { token: 'tok' },
    );

    const cuerpo = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(cuerpo).toMatchObject({ eventType: 'escenario.generado', relatedEntityType: 'escenario', recipientUserId: 'u-1' });
    expect(cuerpo).not.toHaveProperty('recipientRole');
  });

  it('un token que ya trae "Bearer" no se duplica', async () => {
    await new NotificationsReporter().notificar(AVISO, { token: 'Bearer abc' });

    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe('Bearer abc');
  });

  it.each([403, 500])('si notifications responde %i no lanza y lo deja en el log', async (status) => {
    fetchMock.mockResolvedValue({ ok: false, status });

    await expect(new NotificationsReporter().notificar(AVISO, { token: 'tok' })).resolves.toBeUndefined();
    expect(avisos).toEqual([`Aviso recomendacion.resuelta rechazado: HTTP ${status}`]);
  });

  it('si la llamada falla (red caída o timeout) no lanza y lo deja en el log', async () => {
    fetchMock.mockRejectedValue(new Error('connect ECONNREFUSED'));

    await expect(new NotificationsReporter().notificar(AVISO, { token: 'tok' })).resolves.toBeUndefined();
    expect(avisos).toEqual(['Aviso no enviado (recomendacion.resuelta): connect ECONNREFUSED']);
  });

  it('corta la llamada con un timeout de 1.5 s', async () => {
    jest.useFakeTimers();
    try {
      fetchMock.mockImplementation(
        (_url: string, opciones: { signal: AbortSignal }) =>
          new Promise((_resolver, rechazar) => {
            opciones.signal.addEventListener('abort', () => rechazar(new Error('This operation was aborted')));
          }),
      );

      const pendiente = new NotificationsReporter().notificar(AVISO, { token: 'tok' });
      jest.advanceTimersByTime(1500);

      await expect(pendiente).resolves.toBeUndefined();
      expect(avisos).toEqual(['Aviso no enviado (recomendacion.resuelta): This operation was aborted']);
    } finally {
      jest.useRealTimers();
    }
  });

  it('sin NOTIFICATIONS_SERVICE_URL no llama a nadie, no lanza y avisa en el log una sola vez', async () => {
    delete process.env.NOTIFICATIONS_SERVICE_URL;
    const reporter = new NotificationsReporter();

    await expect(reporter.notificar(AVISO, { token: 'tok' })).resolves.toBeUndefined();
    await expect(reporter.notificar(AVISO, { token: 'tok' })).resolves.toBeUndefined();

    expect(fetchMock).not.toHaveBeenCalled();
    expect(avisos).toEqual(['NOTIFICATIONS_SERVICE_URL no está definida: no se envían avisos a notifications-service.']);
  });
});
