import { app, BrowserWindow, ipcMain, safeStorage } from 'electron';
import path from 'node:path';
import fs from 'node:fs';

// Dónde guardamos el token cifrado. `safeStorage` de Electron usa el
// almacén de credenciales del sistema operativo (Keychain en macOS,
// DPAPI en Windows, libsecret en Linux) para cifrar/descifrar — nunca
// guardamos el JWT en texto plano en disco. Esto es el equivalente de
// EncryptedSharedPreferences que usamos en la app móvil.
const TOKEN_FILE = path.join(app.getPath('userData'), 'session.bin');

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true, // el renderer NUNCA tiene acceso directo a Node/fs
      nodeIntegration: false,
    },
  });

  const devServerUrl = process.env.VITE_DEV_SERVER_URL;
  if (devServerUrl) {
    win.loadURL(devServerUrl);
    win.webContents.openDevTools();
  } else {
    win.loadFile(path.join(__dirname, '../dist/index.html'));
  }
}

// --- IPC: guardado seguro de sesión -----------------------------------
// El renderer (React) nunca cifra/descifra directamente; le pide al
// proceso main que lo haga, vía estos tres canales. Así el código de
// React no necesita saber nada sobre `safeStorage` o el filesystem.

ipcMain.handle('session:save', (_event, token: string) => {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('El cifrado del sistema operativo no está disponible en esta máquina');
  }
  const encrypted = safeStorage.encryptString(token);
  fs.writeFileSync(TOKEN_FILE, encrypted);
});

ipcMain.handle('session:get', () => {
  if (!fs.existsSync(TOKEN_FILE)) return null;
  const encrypted = fs.readFileSync(TOKEN_FILE);
  try {
    return safeStorage.decryptString(encrypted);
  } catch {
    return null; // archivo corrupto o cifrado con otra llave de máquina
  }
});

ipcMain.handle('session:clear', () => {
  if (fs.existsSync(TOKEN_FILE)) fs.unlinkSync(TOKEN_FILE);
});

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
