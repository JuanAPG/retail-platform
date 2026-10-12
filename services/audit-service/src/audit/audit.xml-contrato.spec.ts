import { execFileSync } from 'child_process';
import { mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { serializarXml } from '../common/interceptors/xml.interceptor';
import { serializarErrorXml } from '../common/filters/http-error.filter';
import * as muestras from '../common/swagger/muestras';

/**
 * Gate local del contrato XML de audit-service: construye el XML con el
 * MISMO serializador que usan el interceptor y el filtro de errores, y lo
 * valida con `xmllint` contra `docs/contratos/audit-service.xsd`. Es el
 * equivalente, sin stack levantado, de lo que mide `scripts/validate-xml.sh`
 * contra un servicio corriendo.
 *
 * Se salta si no hay `xmllint` instalado (no está en todas las máquinas de
 * desarrollo; el CI y la VM de QA sí lo tienen).
 */
const XSD = join(__dirname, '..', '..', '..', '..', 'docs', 'contratos', 'audit-service.xsd');

function tieneXmllint(): boolean {
  try {
    execFileSync('xmllint', ['--version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function validarContraXsd(xml: string): string | null {
  const dir = mkdtempSync(join(tmpdir(), 'audit-xsd-'));
  const archivo = join(dir, 'doc.xml');
  writeFileSync(archivo, xml);
  try {
    execFileSync('xmllint', ['--noout', '--schema', XSD, archivo], { stdio: 'pipe' });
    return null;
  } catch (error) {
    const salida = error as { stderr?: Buffer };
    return salida.stderr?.toString() ?? String(error);
  }
}

const describeSiHayXmllint = tieneXmllint() ? describe : describe.skip;

describeSiHayXmllint('XML de audit-service valida contra el XSD', () => {
  const NS_ORIGINAL = process.env.XML_NAMESPACE;

  beforeAll(() => {
    // El mismo valor que infra/docker-compose.yml fija para este servicio.
    process.env.XML_NAMESPACE = 'audit/v1';
  });

  afterAll(() => {
    if (NS_ORIGINAL === undefined) delete process.env.XML_NAMESPACE;
    else process.env.XML_NAMESPACE = NS_ORIGINAL;
  });

  it('auditCreateResponse (POST)', () => {
    const fallo = validarContraXsd(serializarXml({ id: '123' }, { raiz: 'auditCreateResponse' }));
    expect(fallo).toBeNull();
  });

  it('auditEventResponse (GET /:id)', () => {
    const fallo = validarContraXsd(serializarXml(muestras.evento, { raiz: 'auditEventResponse' }));
    expect(fallo).toBeNull();
  });

  it('auditEventResponse sin cambios (<cambios/> autocerrada) también valida', () => {
    const fallo = validarContraXsd(serializarXml(muestras.eventoSinCambios, { raiz: 'auditEventResponse' }));
    expect(fallo).toBeNull();
  });

  it('auditListResponse (GET)', () => {
    const fallo = validarContraXsd(serializarXml(muestras.pagina, { raiz: 'auditListResponse' }));
    expect(fallo).toBeNull();
  });

  it('error 404 (id inexistente) valida contra el elemento error', () => {
    const cuerpo = {
      statusCode: 404,
      message: 'El evento no existe.',
      code: 'NOT_FOUND',
      details: null,
      path: '/v1/auditoria/999999999999',
      timestamp: new Date().toISOString(),
    };
    const fallo = validarContraXsd(serializarErrorXml(cuerpo));
    expect(fallo).toBeNull();
  });

  it('error 401 (sin sesión) valida contra el elemento error', () => {
    const cuerpo = {
      statusCode: 401,
      message: 'Falta el token de sesión (Bearer).',
      code: 'UNAUTHORIZED',
      details: null,
      path: '/v1/auditoria',
      timestamp: new Date().toISOString(),
    };
    const fallo = validarContraXsd(serializarErrorXml(cuerpo));
    expect(fallo).toBeNull();
  });
});
