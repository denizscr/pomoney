// PRO MONEY — Electron Desktop App Launcher (Windows .exe / macOS .dmg / Linux .AppImage)
const { app, BrowserWindow, shell } = require('electron');
const path = require('node:path');

const APP_URL = process.env.PRO_MONEY_DESKTOP_URL || process.env.APP_URL || 'http://127.0.0.1:3000';

function createMainWindow() {
  const mainWindow = new BrowserWindow({
    width: 1360,
    height: 860,
    minWidth: 1024,
    minHeight: 700,
    title: 'PRO MONEY — Digital Banking',
    icon: path.join(__dirname, '..', 'public', 'pwa-512x512.png'),
    backgroundColor: '#F8FAFC',
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  if (process.env.PRO_MONEY_LOAD_DIST === 'true') {
    mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  } else {
    mainWindow.loadURL(APP_URL);
  }

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
}

app.whenReady().then(() => {
  createMainWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
