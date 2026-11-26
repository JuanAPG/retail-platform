import { AvailabilityClient } from './availability-client.service';

function responder(status: number, cuerpo: unknown) {
  return jest.spyOn(global, 'fetch').mockResolvedValue(new Response(JSON.stringify(cuerpo), { status, headers: { 'Content-Type': 'application/json' } }));
}

describe('AvailabilityClient.coberturaZona (D-38)', () => {
  afterEach(() => jest.restoreAllMocks());

  it('coverage 75 → 0.75, con el token reenviado', async () => {
    const f = responder(200, { disponible: true, coverage: 75, motivo: null });
    expect(await new AvailabilityClient().coberturaZona('z-1', 'Bearer t')).toEqual({ estado: 'ok', valor: 0.75 });
    const [url, init] = f.mock.calls[0] as [string, RequestInit];
    expect(url).toMatch(/\/v1\/availability\/zones\/z-1\/coverage$/);
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer t');
  });

  it('disponible:false → sin_datos con el motivo (nunca un número inventado)', async () => {
    responder(200, { disponible: false, motivo: 'ninguna tienda con dato vigente' });
    expect(await new AvailabilityClient().coberturaZona('z-1')).toEqual({ estado: 'sin_datos', motivo: 'ninguna tienda con dato vigente' });
  });

  it('error HTTP o de red → no_responde (nunca lanza)', async () => {
    responder(503, {});
    expect((await new AvailabilityClient().coberturaZona('z-1')).estado).toBe('no_responde');
    jest.spyOn(global, 'fetch').mockRejectedValue(new Error('ECONNREFUSED'));
    expect(await new AvailabilityClient().coberturaZona('z-1')).toEqual({ estado: 'no_responde', motivo: 'ECONNREFUSED' });
  });
});
