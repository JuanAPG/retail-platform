import { HttpException, HttpStatus } from '@nestjs/common';
import { HttpErrorFilter } from './http-error.filter';

function anfitrion(url: string) {
  const json = jest.fn();
  const host = {
    switchToHttp: () => ({
      getRequest: () => ({ url }),
      getResponse: () => ({ status: () => ({ json }) }),
    }),
  };
  return { host: host as never, json };
}

describe('HttpErrorFilter (cuerpo estándar)', () => {
  const filtro = new HttpErrorFilter();

  it('mapea 404 a NOT_FOUND con path y timestamp', () => {
    const { host, json } = anfitrion('/v1/usuarios/1');
    filtro.catch(new HttpException('El usuario no existe.', HttpStatus.NOT_FOUND), host);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({ statusCode: 404, code: 'NOT_FOUND', path: '/v1/usuarios/1' }),
    );
  });

  it('respeta el code propio que manda el servicio', () => {
    const { host, json } = anfitrion('/v1/auth/login');
    filtro.catch(
      new HttpException({ message: 'x', code: 'RATE_LIMITED' }, HttpStatus.TOO_MANY_REQUESTS),
      host,
    );
    expect(json).toHaveBeenCalledWith(expect.objectContaining({ code: 'RATE_LIMITED' }));
  });

  it('lo desconocido cae a 500 INTERNAL sin filtrar detalles', () => {
    const { host, json } = anfitrion('/v1/auth/login');
    filtro.catch(new Error('ECONNREFUSED 5432'), host);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({ statusCode: 500, code: 'INTERNAL' }),
    );
  });
});
