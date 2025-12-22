const fs = require('node:fs');
const path = require('node:path');
const { app, BrowserWindow, Menu, ipcMain, dialog } = require('electron');
// Lazy-load autoUpdater to avoid crashing in dev when Electron isn't fully initialized
let autoUpdater;

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
  if (!autoUpdater) {
    try {
      autoUpdater = require('electron-updater').autoUpdater;
    } catch (err) {
      console.error('Failed to load autoUpdater:', err);
      return;
    }
  }
  const updaterToken = loadUpdaterToken();
  if (updaterToken) {
    autoUpdater.requestHeaders = { Authorization: `token ${updaterToken}` };
  } else {
    console.warn('No updater token found; private GitHub releases will return 404.');
  }

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = false; // Wait for user confirmation
  autoUpdater.allowPrerelease = false;

  autoUpdater.on('checking-for-update', () => {
    console.log('Checking for updates...');
    if (mainWindow) mainWindow.webContents.send('update-checking');
  });

  autoUpdater.on('update-available', info => {
    console.log(`Update available: ${info.version}`);
    if (mainWindow) mainWindow.webContents.send('update-available', info);
  });

  autoUpdater.on('update-not-available', info => {
    console.log('No updates available.');
    if (mainWindow) mainWindow.webContents.send('update-not-available', info);
  });

  autoUpdater.on('download-progress', progress => {
    if (mainWindow) mainWindow.webContents.send('download-progress', progress);
  });

  autoUpdater.on('update-downloaded', info => {
    console.log(`Update downloaded: ${info.version}`);
    if (mainWindow) mainWindow.webContents.send('update-downloaded', info);
    // Do NOT quit automatically
  });

  autoUpdater.on('error', err => {
    console.error('Auto-update error:', err);
    const message = err?.message || String(err) || 'Unknown update error';
    const hint = /404/i.test(message)
      ? ' (404 from GitHub; check AUTO_UPDATE_TOKEN or release assets)'
      : '';
    if (mainWindow) mainWindow.webContents.send('update-error', `${message}${hint}`);
  });

  // Handle manual check trigger
  ipcMain.handle('check-for-updates', async () => {
    return await autoUpdater.checkForUpdates();
  });

  ipcMain.handle('quit-and-install', () => {
    autoUpdater.quitAndInstall();
  });

  autoUpdater.checkForUpdatesAndNotify().catch(err => {
    console.error('Failed to check for updates', err);
  });
}

function createWindow() {
  Menu.setApplicationMenu(null);
  const preloadCandidates = [
    path.join(__dirname, 'preload.js'),
    path.join(app.getAppPath(), 'electron', 'preload.js'),
    path.join(process.resourcesPath || '', 'app.asar', 'electron', 'preload.js'),
    path.join(process.resourcesPath || '', 'app', 'electron', 'preload.js'),
  ].filter(Boolean);
  const preloadPath = preloadCandidates.find(candidate => fs.existsSync(candidate)) || path.join(__dirname, 'preload.js');
  if (!fs.existsSync(preloadPath)) {
    console.error('Preload script not found. Electron APIs will be unavailable.', { preloadCandidates });
  }
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    autoHideMenuBar: true,
    webPreferences: {
      preload: preloadPath,
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

ipcMain.handle('select-files', async () => {
  const result = await dialog.showOpenDialog({
    properties: ['openFile', 'multiSelections'],
    filters: [{ name: 'PDF Files', extensions: ['pdf'] }],
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  return result.filePaths;
});

ipcMain.handle('capture-screen', async () => {
  const { screen, desktopCapturer } = require('electron');

  const primaryDisplay = screen.getPrimaryDisplay();
  const { width, height, scaleFactor } = primaryDisplay;

  // Fetch sources from the main process
  const sources = await desktopCapturer.getSources({
    types: ['screen'],
    thumbnailSize: {
      width: Math.floor(width * scaleFactor),
      height: Math.floor(height * scaleFactor),
    },
  });

  const source = sources[0]; // Usually the primary screen
  if (!source) {
    throw new Error('No screens available for capture');
  }

  return source.thumbnail.toDataURL();
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
