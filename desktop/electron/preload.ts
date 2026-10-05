import { contextBridge, ipcRenderer } from 'electron';

/**
 * `contextBridge` es la única puerta entre el proceso main (Node, con
 * acceso a filesystem/OS) y el renderer (React, que corre como si fuera
 * una página web normal). Sin esto, con `contextIsolation: true` (como lo
 * dejamos en main.ts), React no podría llamar a session:save/get/clear
 * para nada — y eso es intencional: es la barrera de seguridad estándar de
 * Electron contra código malicioso en el renderer.
 *
 * `window.electronAPI` es lo único que el código de React puede tocar.
 */
contextBridge.exposeInMainWorld('electronAPI', {
  saveSession: (token: string) => ipcRenderer.invoke('session:save', token),
  getSession: () => ipcRenderer.invoke('session:get'),
  clearSession: () => ipcRenderer.invoke('session:clear'),
});
