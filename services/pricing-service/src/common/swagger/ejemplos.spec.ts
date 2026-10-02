import { XMLValidator } from 'fast-xml-parser';
import { ejemploXml, pagina } from './ejemplos';
import { muestras } from './muestras';

describe('ejemploXml', () => {
  it('envuelve en <response> y cada elemento de una lista sale como <item>', () => {
    const xml = ejemploXml(pagina([muestras.precio, muestras.precioCerrado], 2));

    expect(xml).toContain('<response>');
    expect(xml.match(/<data>/g)).toHaveLength(1);
    // Cada precio de la página es un <item> dentro de <data>.
    expect(xml.match(/<item>/g)).toHaveLength(2);
    expect(xml).toContain('<total>2</total>');
  });

  it('un precio sale con su resumen de presentación y tienda anidado', () => {
    const xml = ejemploXml(muestras.precio);

    expect(xml).toContain('<price>42.50</price>');
    expect(xml).toMatch(/<presentation>[\s\S]*<unidadMedida>kg<\/unidadMedida>[\s\S]*<\/presentation>/);
    expect(xml).toMatch(/<store>[\s\S]*<zona>[\s\S]*<nombre>Zona Centro<\/nombre>/);
  });

  it('la comparación por zonas anida las zonas como <item>', () => {
    const xml = ejemploXml(muestras.comparacion);

    expect(xml).toMatch(/<zones>\s*<item>/);
    expect(xml).toContain('<averagePrice>41.25</averagePrice>');
  });

  it('todas las muestras producen XML bien formado', () => {
    for (const [nombre, muestra] of Object.entries(muestras)) {
      expect({ nombre, valido: XMLValidator.validate(ejemploXml(muestra)) }).toEqual({ nombre, valido: true });
    }
  });
});
