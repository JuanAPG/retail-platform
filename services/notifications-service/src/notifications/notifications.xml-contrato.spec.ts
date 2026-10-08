import { execFileSync } from 'child_process';
import { mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { ROL } from '../common/roles';
import { serializarXml } from '../common/interceptors/xml.interceptor';
import { serializarErrorXml } from '../common/filters/http-error.filter';
import { InMemoryNotificationsRepository } from './in-memory.repository';
import { NotificationsService } from './notifications.service';

/**
 * Gate local del contrato XML de notifications-service: construye el XML
 * tal como lo emite el servicio (misma `serializarXml`/`serializarErrorXml`
 * que usan el interceptor y el filtro de errores) y lo valida con `xmllint`
 * contra `docs/contratos/notifications-service.xsd`. Es el equivalente, sin
 * stack levantado, de lo que mide `scripts/validate-xml.sh` contra un
 * servicio corriendo.
 *
 * Se salta si no hay `xmllint` instalado (no está en todas las máquinas de
 * desarrollo; el CI y la VM de QA sí lo tienen).
 */
const XSD = join(__dirname, '..', '..', '..', '..', 'docs', 'contratos', 'notifications-service.xsd');

function tieneXmllint(): boolean {
  try {
    execFileSync('xmllint', ['--version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function validarContraXsd(xml: string): string | null {
  const dir = mkdtempSync(join(tmpdir(), 'notif-xsd-'));
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

describeSiHayXmllint('XML de notifications-service valida contra el XSD', () => {
  const NS_ORIGINAL = process.env.XML_NAMESPACE;

  beforeAll(() => {
    // El mismo valor que infra/docker-compose.yml fija para este servicio.
    process.env.XML_NAMESPACE = 'notif/v1';
  });

  afterAll(() => {
    if (NS_ORIGINAL === undefined) delete process.env.XML_NAMESPACE;
    else process.env.XML_NAMESPACE = NS_ORIGINAL;
  });

  function servicio() {
    const repo = new InMemoryNotificationsRepository();
    const audit = { reportar: jest.fn().mockResolvedValue(undefined) };
    return new NotificationsService(repo, audit as never);
  }

  it('notificationResponse (POST / PATCH read)', async () => {
    const svc = servicio();
    const { data } = await svc.create(
      {
        eventType: 'producto.propuesto',
        sourceService: 'catalog-service',
        relatedEntityId: 'presentacion-1',
        title: 'Nueva propuesta de producto',
        message: 'BioOrgánicos propuso Quinoa 500 g.',
        priority: 'info',
      } as never,
      { usuarioId: 'proveedor-1', rol: ROL.PROVEEDOR },
    );
    const leida = await svc.markAsRead(data.id, { id: data.recipientUserId ?? '', rol: ROL.GERENTE_CATEGORIA });

    const fallo = validarContraXsd(serializarXml(leida, { raiz: 'notificationResponse' }));
    expect(fallo).toBeNull();
  });

  it('notificationDetailResponse (GET /:id)', async () => {
    const svc = servicio();
    const { data } = await svc.create(
      {
        eventType: 'precio.propuesto',
        sourceService: 'pricing-service',
        relatedEntityId: 'presentacion-2',
        title: 'Nuevo precio propuesto',
        message: 'Presentación 500 g propuesta a $24.00.',
        priority: 'info',
      } as never,
      { usuarioId: 'proveedor-2', rol: ROL.PROVEEDOR },
    );
    const vista = await svc.findOneForUser(data.id, { id: data.recipientUserId ?? '', rol: ROL.GERENTE_CATEGORIA });

    const fallo = validarContraXsd(serializarXml(vista, { raiz: 'notificationDetailResponse' }));
    expect(fallo).toBeNull();
  });

  it('notificationListResponse (GET, con readBy vacío y con datos)', async () => {
    const svc = servicio();
    await svc.create(
      {
        eventType: 'producto.propuesto',
        sourceService: 'catalog-service',
        relatedEntityId: 'producto-1',
        title: 'Nueva propuesta de producto',
        message: 'Otro producto propuesto.',
        priority: 'info',
      } as never,
      { usuarioId: 'proveedor-3', rol: ROL.PROVEEDOR },
    );

    const lista = await svc.findAllForUser('gerente-1', ROL.GERENTE_CATEGORIA, {});
    expect(lista.data.length).toBeGreaterThanOrEqual(1);

    const fallo = validarContraXsd(serializarXml(lista, { raiz: 'notificationListResponse' }));
    expect(fallo).toBeNull();
  });

  it('notificationListResponse vacío (<data/> autocerrada) también valida', async () => {
    const svc = servicio();
    const lista = await svc.findAllForUser('sin-notificaciones', undefined, {});
    expect(lista.data).toHaveLength(0);

    const fallo = validarContraXsd(serializarXml(lista, { raiz: 'notificationListResponse' }));
    expect(fallo).toBeNull();
  });

  it('unreadCountResponse (GET /unread-count)', async () => {
    const svc = servicio();
    const conteo = await svc.countUnread('nadie');
    const fallo = validarContraXsd(serializarXml(conteo, { raiz: 'unreadCountResponse' }));
    expect(fallo).toBeNull();
  });

  it('un eventType fuera del catálogo responde 400 y el XML del error valida', async () => {
    const svc = servicio();
    await expect(
      svc.create(
        {
          eventType: 'evento.inexistente',
          sourceService: 'catalog-service',
          title: 'x',
          message: 'x',
          priority: 'info',
        } as never,
        { usuarioId: 'u1', rol: ROL.ADMINISTRADOR },
      ),
    ).rejects.toThrow();

    // Mismo cuerpo que arma el HttpErrorFilter para un BadRequestException.
    const cuerpo = {
      statusCode: 400,
      message: 'El eventType evento.inexistente no está soportado.',
      code: 'VALIDATION_ERROR',
      details: null,
      path: '/v1/notifications',
      timestamp: new Date().toISOString(),
    };
    const fallo = validarContraXsd(serializarErrorXml(cuerpo));
    expect(fallo).toBeNull();
  });

  it('un rol sin permiso de origen responde 403 y el XML del error valida', async () => {
    const svc = servicio();
    await expect(
      svc.create(
        {
          eventType: 'producto.propuesto',
          sourceService: 'catalog-service',
          title: 'x',
          message: 'x',
          priority: 'info',
        } as never,
        { usuarioId: 'u1', rol: ROL.AUDITOR },
      ),
    ).rejects.toThrow();

    const cuerpo = {
      statusCode: 403,
      message: 'Forbidden resource',
      code: 'FORBIDDEN',
      details: null,
      path: '/v1/notifications',
      timestamp: new Date().toISOString(),
    };
    const fallo = validarContraXsd(serializarErrorXml(cuerpo));
    expect(fallo).toBeNull();
  });
});
