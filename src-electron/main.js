const { app, BrowserWindow, Menu, ipcMain, components } = require('electron');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const {
  UI_HOST, UI_PORT, UI_ORIGIN, LOGIN_HOST, LOGIN_PORT,
  createUiServer, createLoginServer, listen,
} = require('./server');

// Chromium names, in the order we try them, when the Electron webview has no Widevine.
const CHROME_CANDIDATES = ['google-chrome-stable', 'google-chrome', 'chromium', 'chromium-browser'];

let chromiumChild = null;

function slimDir() {
  if (app.isPackaged) return path.join(process.resourcesPath, 'slim');
  return path.join(__dirname, '..', 'slim');
}

function findChromium() {
  const dirs = (process.env.PATH || '').split(':').filter(Boolean);
  for (const name of CHROME_CANDIDATES) {
    for (const dir of dirs) {
      const candidate = path.join(dir, name);
      try {
        fs.accessSync(candidate, fs.constants.X_OK);
        return candidate;
      } catch {
        // try the next candidate
      }
    }
  }
  return null;
}

function openChromiumFallback() {
  if (chromiumChild) return { ok: true };
  const bin = findChromium();
  if (!bin) {
    return {
      ok: false,
      error: 'No Chrome or Chromium found. Install google-chrome-stable or chromium, then restart slim.',
    };
  }
  // A private user-data-dir keeps this process alive until its window closes. Reusing the
  // default profile hands the URL to an already-running browser and exits immediately.
  const userData = path.join(app.getPath('userData'), 'chromium');
  chromiumChild = spawn(bin, [
    `--app=${UI_ORIGIN}/`,
    `--user-data-dir=${userData}`,
    '--class=slim',
    '--no-first-run',
    '--no-default-browser-check',
  ], { stdio: 'ignore' });
  chromiumChild.on('exit', () => app.quit());
  for (const win of BrowserWindow.getAllWindows()) win.close();
  return { ok: true };
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1000,
    height: 640,
    minWidth: 640,
    minHeight: 380,
    title: 'slim',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  win.webContents.on('console-message', (event) => {
    if (String(event.message || '').startsWith('DRM key system:')) console.log(event.message);
  });
  win.loadURL(`${UI_ORIGIN}/`);
  return win;
}

async function start() {
  const ui = createUiServer(slimDir());
  const login = createLoginServer();
  try {
    await listen(ui, UI_HOST, UI_PORT);
  } catch (err) {
    console.error(`slim: could not bind ${UI_HOST}:${UI_PORT} (${err.message}). Quit any other slim or tauri dev first.`);
    app.exit(1);
    return;
  }
  try {
    await listen(login, LOGIN_HOST, LOGIN_PORT);
  } catch (err) {
    console.error(`slim: could not bind ${LOGIN_HOST}:${LOGIN_PORT} (${err.message}); fallback sign-in will be unavailable`);
  }
  if (components?.whenReady) {
    try {
      await components.whenReady();
      console.info('Widevine components:', components.status?.());
    } catch (err) {
      console.error('Widevine CDM not ready:', err);
    }
  }
  createWindow();
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  Menu.setApplicationMenu(null);
  ipcMain.handle('set-zoom', (event, factor) => {
    const z = Number(factor);
    if (!Number.isFinite(z)) return;
    event.sender.setZoomFactor(Math.min(2, Math.max(0.7, z)));
  });
  ipcMain.handle('open-chromium-fallback', () => openChromiumFallback());

  app.on('second-instance', () => {
    const win = BrowserWindow.getAllWindows()[0];
    if (!win) return;
    if (win.isMinimized()) win.restore();
    win.focus();
  });
  app.on('window-all-closed', () => {
    if (!chromiumChild) app.quit();
  });
  app.whenReady().then(start);
}
