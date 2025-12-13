const fs = require('node:fs');
const path = require('node:path');
const { app, BrowserWindow, Menu, ipcMain, dialog } = require('electron');
const { autoUpdater } = require('electron-updater');

const isDev = !app.isPackaged;
const openDevTools = process.env.ELECTRON_DEBUG === 'true';
let mainWindow;

function loadUpdaterToken() {
  const envToken = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
  if (envToken) return envToken;

  const candidatePaths = [];

  if (process.resourcesPath) {
    candidatePaths.push(path.join(process.resourcesPath, 'update-token.json'));
    candidatePaths.push(path.join(process.resourcesPath, 'app', 'build', 'update-token.json'));
    candidatePaths.push(path.join(process.resourcesPath, 'app.asar', 'build', 'update-token.json'));
  }

  const appPath = app.getAppPath ? app.getAppPath() : __dirname;
  candidatePaths.push(path.join(appPath, 'build', 'update-token.json'));
  candidatePaths.push(path.join(__dirname, '..', 'build', 'update-token.json'));
  candidatePaths.push(path.join(process.cwd(), 'build', 'update-token.json'));

  for (const tokenPath of candidatePaths) {
    if (fs.existsSync(tokenPath)) {
      try {
        const parsed = JSON.parse(fs.readFileSync(tokenPath, 'utf8'));
        if (parsed?.token) return parsed.token;
      } catch (err) {
        console.warn(`Failed to read updater token from ${tokenPath}:`, err);
      }
    }
  }

  return null;
}

function registerAutoUpdater() {
  const updaterToken = loadUpdaterToken();
  if (updaterToken) {
    autoUpdater.requestHeaders = { Authorization: `token ${updaterToken}` };
  }

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on('checking-for-update', () => {
    console.log('Checking for updates...');
  });

  autoUpdater.on('update-available', info => {
    console.log(`Update available: ${info.version}`);
  });

  autoUpdater.on('update-not-available', () => {
    console.log('No updates available.');
  });

  autoUpdater.on('download-progress', progress => {
    const logMessage = [
      `Download speed: ${progress.bytesPerSecond}`,
      `Downloaded ${progress.percent.toFixed(2)}%`,
      `(${progress.transferred}/${progress.total})`
    ].join(' - ');
    console.log(logMessage);
  });

  autoUpdater.on('update-downloaded', info => {
    console.log(`Update downloaded: ${info.version}; quitting and installing...`);
    autoUpdater.quitAndInstall();
  });

  autoUpdater.on('error', err => {
    console.error('Auto-update error:', err);
  });

  autoUpdater.checkForUpdatesAndNotify().catch(err => {
    console.error('Failed to check for updates', err);
  });
}

function createWindow() {
  Menu.setApplicationMenu(null);
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  const devUrl = process.env.ELECTRON_START_URL || 'http://localhost:5173';
  if (isDev) {
    mainWindow.loadURL(devUrl);
    if (openDevTools) {
      mainWindow.webContents.openDevTools({ mode: 'detach' });
    }
  } else {
    mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  }
}

ipcMain.handle('select-folder', async () => {
  const result = await dialog.showOpenDialog({
    properties: ['openDirectory'],
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  return result.filePaths[0];
});

app.whenReady().then(() => {
  createWindow();

  if (app.isPackaged) {
    registerAutoUpdater();
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
