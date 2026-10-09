import { XMLValidator } from 'fast-xml-parser';
import { ejemploXml, pagina } from './ejemplos';
import { muestras } from './muestras';

describe('ejemploXml', () => {
  it('sin raíz declarada conserva <response>, ahora con el namespace del servicio; cada elemento de una lista sale como <item>', () => {
    const xml = ejemploXml(pagina([{ id: 1 }, { id: 2 }], 2));

    expect(xml).toContain('<response xmlns="catalog/v1">');
    expect(xml.match(/<item>/g)).toHaveLength(2);
    // Sin esto el builder repetiría <data>…</data><data>…</data>.
    expect(xml.match(/<data>/g)).toHaveLength(1);
    expect(xml).toContain('<total>2</total>');
  });

  it('CAT-15: con raíz declarada el ejemplo trae la raíz y el namespace reales del XSD', () => {
    const xml = ejemploXml(pagina([{ id: 1 }], 1), 'segmentListResponse');

    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
    expect(xml).toContain('<segmentListResponse xmlns="catalog/v1">');
    expect(xml).not.toContain('<response');
  });

  it('una lista plana sale como <response><item>…</item></response>', () => {
    const xml = ejemploXml([muestras.municipio]);

    expect(xml).toContain('<item>');
    expect(xml).toContain('<nombre>Monterrey</nombre>');
  });

  it('todas las muestras producen XML bien formado', () => {
    for (const [nombre, muestra] of Object.entries(muestras)) {
      expect({ nombre, valido: XMLValidator.validate(ejemploXml(muestra)) }).toEqual({ nombre, valido: true });
    }
  });

  it('las presentaciones anidadas de un producto también salen como <item>', () => {
    const xml = ejemploXml(muestras.producto);

    expect(xml).toMatch(/<presentaciones>\s*<item>/);
  });
});
