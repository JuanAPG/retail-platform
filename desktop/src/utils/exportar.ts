export interface Columna<T> {
  /** Nombre de la etiqueta XML (sin espacios ni acentos). */
  clave: string;
  /** Encabezado legible para el CSV. */
  titulo: string;
  valor: (fila: T) => string | number | boolean | null | undefined;
}

function aTexto(v: string | number | boolean | null | undefined): string {
  return v === null || v === undefined ? '' : String(v);
}

function celdaCsv(v: string | number | boolean | null | undefined): string {
  let texto = aTexto(v);
  if (typeof v === 'string' && /^[=+\-@]/.test(texto)) texto = `'${texto}`;
  return /[",\r\n]/.test(texto) ? `"${texto.replace(/"/g, '""')}"` : texto;
}

export function toCsv<T>(columnas: Columna<T>[], filas: T[]): string {
  const encabezado = columnas.map((c) => celdaCsv(c.titulo)).join(',');
  const cuerpo = filas.map((f) => columnas.map((c) => celdaCsv(c.valor(f))).join(','));
  return '\uFEFF' + [encabezado, ...cuerpo].join('\r\n');
}

function escaparXml(texto: string): string {
  return texto
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export function toXml<T>(raiz: string, fila: string, columnas: Columna<T>[], filas: T[]): string {
  const filasXml = filas.map((f) => {
    const campos = columnas.map((c) => `    <${c.clave}>${escaparXml(aTexto(c.valor(f)))}</${c.clave}>`);
    return `  <${fila}>\n${campos.join('\n')}\n  </${fila}>`;
  });
  return `<?xml version="1.0" encoding="UTF-8"?>\n<${raiz}>\n${filasXml.join('\n')}\n</${raiz}>\n`;
}

export function descargar(nombreArchivo: string, contenido: string, mime: string): void {
  const url = URL.createObjectURL(new Blob([contenido], { type: `${mime};charset=utf-8` }));
  const enlace = document.createElement('a');
  enlace.href = url;
  enlace.download = nombreArchivo;
  document.body.appendChild(enlace);
  enlace.click();
  enlace.remove();
  URL.revokeObjectURL(url);
}