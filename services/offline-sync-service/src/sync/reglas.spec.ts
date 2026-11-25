import { ROL } from '../common/roles';
import {
  huellaCaptura,
  huellaLote,
  idsRepetidos,
  ISO_CON_ZONA,
  perdedorasDentroDelLote,
  puedeEnviarTipo,
  validarCaptura,
} from './reglas';
import { CapturaEntrada, LoteEntrada } from './tipos';

const AHORA = new Date('2026-10-30T15:00:00.000Z');

function captura(parcial: Partial<CapturaEntrada> = {}): CapturaEntrada {
  return {
    captureId: 'c0a8012e-7d7c-4b5e-9a51-0d6f3f2a9b11',
    type: 'disponibilidad',
    contractVersion: '1.0',
    capturedAt: '2026-10-26T09:30:00-06:00',
    storeId: '27f05c81-c6bf-456a-a273-150e4edb9900',
    presentationId: '5b0d6a0e-1c1e-4f43-9c5b-2a6f1c1e9d77',
    content: { stock: 12 },
    ...parcial,
  };
}

describe('validarCaptura (contrato §4.4)', () => {
  it('acepta una disponibilidad y un precio válidos', () => {
    expect(validarCaptura(captura(), AHORA)).toBeNull();
    expect(
      validarCaptura(captura({ type: 'precio_observado', content: { price: 27.5, lat: 25.6866, lng: -100.3161 } }), AHORA),
    ).toBeNull();
  });

  it.each([
    ['versión no soportada', { contractVersion: '2.0' }, 'contractVersion 2.0'],
    ['sin storeId', { storeId: undefined }, 'storeId es obligatorio'],
    ['sin presentationId', { presentationId: undefined }, 'presentationId es obligatorio'],
    ['stock negativo', { content: { stock: -1 } }, 'no puede ser negativo'],
    ['stock con 3 decimales', { content: { stock: 1.234 } }, 'hasta 2 decimales'],
    ['disponibilidad con precio', { content: { stock: 1, price: 3 } }, 'solo lleva content.stock'],
    ['capturada a +6 min', { capturedAt: '2026-10-30T15:06:00Z' }, 'futuro'],
  ])('rechaza %s', (_caso, parcial, texto) => {
    const motivo = validarCaptura(captura(parcial as Partial<CapturaEntrada>), AHORA);
    expect(motivo?.code).toBe('VALIDATION_ERROR');
    expect(motivo?.message).toContain(texto);
  });

  it.each([
    ['precio en 0', { price: 0 }, 'content.price debe ser mayor a 0.'],
    ['precio negativo (ejemplo del contrato)', { price: -3 }, 'content.price debe ser mayor a 0.'],
    ['lat sin lng', { price: 10, lat: 25 }, 'van juntas'],
    ['lat fuera de rango', { price: 10, lat: 91, lng: 0 }, 'entre -90 y 90'],
  ])('precio_observado: rechaza %s', (_caso, content, texto) => {
    const motivo = validarCaptura(captura({ type: 'precio_observado', content }), AHORA);
    expect(motivo?.message).toContain(texto);
  });

  it('acepta hasta 5 minutos en el futuro (relojes de teléfono)', () => {
    expect(validarCaptura(captura({ capturedAt: '2026-10-30T15:05:00Z' }), AHORA)).toBeNull();
  });
});

describe('permiso por tipo de captura (§2)', () => {
  it.each([
    [ROL.INVESTIGADOR, 'disponibilidad', true],
    [ROL.INVESTIGADOR, 'precio_observado', true],
    [ROL.ANALISTA, 'disponibilidad', true],
    [ROL.RESPONSABLE_PRECIOS, 'precio_observado', true],
    [ROL.RESPONSABLE_PRECIOS, 'disponibilidad', false],
    [ROL.PLANEADOR, 'disponibilidad', false],
    [ROL.PLANEADOR, 'precio_observado', false],
    [ROL.GERENTE_CATEGORIA, 'precio_observado', false],
  ] as const)('%s → %s: %s', (rol, tipo, esperado) => {
    expect(puedeEnviarTipo(rol, tipo)).toBe(esperado);
  });
});

describe('huellas (idempotencia)', () => {
  it('el mismo instante en otra zona horaria da la misma huella', () => {
    expect(huellaCaptura(captura())).toBe(huellaCaptura(captura({ capturedAt: '2026-10-26T15:30:00Z' })));
  });

  it('otro contenido da otra huella', () => {
    expect(huellaCaptura(captura())).not.toBe(huellaCaptura(captura({ content: { stock: 13 } })));
  });

  it('sentAt y client no cambian la huella del lote (un reintento puede traer otro sentAt)', () => {
    const base: LoteEntrada = {
      batchId: 'b',
      deviceId: 'd',
      contractVersion: '1.0',
      client: 'movil',
      sentAt: '2026-10-30T09:00:00-06:00',
      captures: [captura()],
    };
    expect(huellaLote(base)).toBe(huellaLote({ ...base, sentAt: '2026-10-30T09:10:00-06:00', client: 'escritorio' }));
    expect(huellaLote(base)).not.toBe(huellaLote({ ...base, captures: [captura({ content: { stock: 1 } })] }));
  });
});

describe('conflicto dentro del mismo lote (§4.7 paso 1)', () => {
  it('gana la captura hecha después, no la que aparece después', () => {
    const vieja = captura({ captureId: 'a', capturedAt: '2026-10-27T10:00:00-06:00' });
    const nueva = captura({ captureId: 'b', capturedAt: '2026-10-27T11:00:00-06:00' });
    const otraTienda = captura({ captureId: 'c', storeId: 'otra' });
    const perdedoras = perdedorasDentroDelLote([nueva, vieja, otraTienda]);
    expect([...perdedoras.keys()]).toEqual(['a']);
    expect(perdedoras.get('a')!.ganadora.captureId).toBe('b');
  });

  it('empate exacto: gana la que aparece primero', () => {
    const primera = captura({ captureId: 'a' });
    const segunda = captura({ captureId: 'b', capturedAt: '2026-10-26T15:30:00Z' });
    expect([...perdedorasDentroDelLote([primera, segunda]).keys()]).toEqual(['b']);
  });

  it('distinto tipo para la misma tienda y presentación no compite', () => {
    const disp = captura({ captureId: 'a' });
    const precio = captura({ captureId: 'b', type: 'precio_observado', content: { price: 1 } });
    expect(perdedorasDentroDelLote([disp, precio]).size).toBe(0);
  });
});

describe('formato', () => {
  it('ISO_CON_ZONA exige segundos y zona, igual que el XSD', () => {
    expect(ISO_CON_ZONA.test('2026-10-26T09:30:00-06:00')).toBe(true);
    expect(ISO_CON_ZONA.test('2026-10-26T15:30:00.120Z')).toBe(true);
    expect(ISO_CON_ZONA.test('2026-10-26T09:30:00')).toBe(false);
    expect(ISO_CON_ZONA.test('2026-10-26T09:30-06:00')).toBe(false);
  });

  it('idsRepetidos encuentra captureId repetidos', () => {
    expect(idsRepetidos([{ captureId: 'a' }, { captureId: 'b' }, { captureId: 'A' }])).toEqual(['A']);
  });
});
