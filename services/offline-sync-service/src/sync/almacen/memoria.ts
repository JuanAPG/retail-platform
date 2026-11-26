import { ServiceUnavailableException } from '@nestjs/common';
import { EstadoEntrega, ResultadoCaptura, Resumen, TipoCaptura } from '../tipos';
import { AlmacenRapido, CapturaEnCache, CapturaGuardada, FiltroLotes, LoteGuardado, RepositorioSync } from './puertos';

/**
 * Adaptadores EN MEMORIA de los puertos, solo para pruebas unitarias (datos
 * aislados por instancia). `fallarEn` simula la caída de un almacén en una
 * operación dada, para probar el 503 y la reanudación.
 */

const copia = <T>(valor: T): T => structuredClone(valor);

export class RepositorioEnMemoria implements RepositorioSync {
  readonly lotes = new Map<string, LoteGuardado>();
  readonly capturas = new Map<string, CapturaGuardada>();
  /** Nombre de la operación que fallará (una vez, o siempre si `siempre`). */
  fallarEn: { operacion: keyof RepositorioSync; siempre?: boolean } | null = null;

  private revisar(operacion: keyof RepositorioSync): void {
    if (this.fallarEn?.operacion === operacion) {
      if (!this.fallarEn.siempre) this.fallarEn = null;
      throw new ServiceUnavailableException('No se pudo guardar el lote: MongoDB no responde. Reintenta más tarde.');
    }
  }

  async buscarLote(batchId: string) {
    this.revisar('buscarLote');
    const lote = this.lotes.get(batchId);
    return lote ? copia(lote) : null;
  }

  async crearLote(lote: LoteGuardado) {
    this.revisar('crearLote');
    if (this.lotes.has(lote.batchId)) return false;
    this.lotes.set(lote.batchId, copia(lote));
    return true;
  }

  async guardarResultados(batchId: string, resultados: ResultadoCaptura[], resumen: Resumen, estados: string[]) {
    this.revisar('guardarResultados');
    const lote = this.lotes.get(batchId);
    if (lote) Object.assign(lote, copia({ resultados, resumen, estados, estado: 'terminado' as const, updatedAt: new Date() }));
  }

  async marcarEntrega(batchId: string, canal: 'audit' | 'notification', estado: EstadoEntrega, error: string | null) {
    this.revisar('marcarEntrega');
    const lote = this.lotes.get(batchId);
    if (!lote) return;
    if (canal === 'audit') Object.assign(lote.delivery, { audit: estado, auditError: error });
    else Object.assign(lote.delivery, { notification: estado, notificationError: error });
  }

  async buscarCapturas(ids: string[]) {
    this.revisar('buscarCapturas');
    const mapa = new Map<string, CapturaGuardada>();
    for (const id of ids) {
      const c = this.capturas.get(id);
      if (c) mapa.set(id, copia(c));
    }
    return mapa;
  }

  async reservarCaptura(captura: CapturaGuardada) {
    this.revisar('reservarCaptura');
    if (this.capturas.has(captura.captureId)) return false;
    this.capturas.set(captura.captureId, copia(captura));
    return true;
  }

  async guardarCaptura(captura: CapturaGuardada) {
    this.revisar('guardarCaptura');
    this.capturas.set(captura.captureId, copia(captura));
  }

  async ultimaAceptada(type: TipoCaptura, storeId: string, presentationId: string) {
    this.revisar('ultimaAceptada');
    let ultima: Date | null = null;
    for (const c of this.capturas.values()) {
      if (c.type === type && c.storeId === storeId && c.presentationId === presentationId && c.status === 'aceptada') {
        if (!ultima || c.capturedAt > ultima) ultima = c.capturedAt;
      }
    }
    return ultima;
  }

  async listarLotes(filtro: FiltroLotes, skip: number, limit: number) {
    this.revisar('listarLotes');
    const filas = [...this.lotes.values()]
      .filter((l) => !filtro.userId || l.userId === filtro.userId)
      .filter((l) => !filtro.deviceId || l.deviceId === filtro.deviceId)
      .filter((l) => !filtro.status || l.estados.includes(filtro.status))
      .filter((l) => !filtro.desde || l.receivedAt >= filtro.desde)
      .filter((l) => !filtro.hasta || l.receivedAt < filtro.hasta)
      .sort((a, b) => b.receivedAt.getTime() - a.receivedAt.getTime());
    return { filas: filas.slice(skip, skip + limit).map(copia), total: filas.length };
  }
}

export class AlmacenEnMemoria implements AlmacenRapido {
  readonly valores = new Map<string, string>();
  caido = false;

  private revisar(): void {
    if (this.caido) {
      throw new ServiceUnavailableException('No se pudo procesar el lote: Redis no responde. Reintenta más tarde.');
    }
  }

  async tomarCandado(batchId: string, dueno: string) {
    this.revisar();
    const llave = `lock:${batchId}`;
    if (this.valores.has(llave)) return false;
    this.valores.set(llave, dueno);
    return true;
  }

  async soltarCandado(batchId: string, dueno: string) {
    this.revisar();
    const llave = `lock:${batchId}`;
    if (this.valores.get(llave) === dueno) this.valores.delete(llave);
  }

  async leerCapturas(ids: string[]) {
    this.revisar();
    const mapa = new Map<string, CapturaEnCache>();
    for (const id of ids) {
      const v = this.valores.get(`captura:${id}`);
      if (v) mapa.set(id, JSON.parse(v));
    }
    return mapa;
  }

  async guardarCaptura(captura: CapturaEnCache) {
    this.revisar();
    this.valores.set(`captura:${captura.captureId}`, JSON.stringify(captura));
  }

  async leerUltimo(llave: string) {
    this.revisar();
    return this.valores.get(`ultimo:${llave}`) ?? null;
  }

  async subirUltimo(llave: string, instanteIso: string) {
    this.revisar();
    const actual = this.valores.get(`ultimo:${llave}`);
    if (!actual || actual < instanteIso) this.valores.set(`ultimo:${llave}`, instanteIso);
  }
}
