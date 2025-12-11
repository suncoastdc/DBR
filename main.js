const fs = require('node:fs');
const path = require('node:path');
const { app, BrowserWindow, Menu } = require('electron');
const { autoUpdater } = require('electron-updater');

let mainWindow;
const isDev = !app.isPackaged;

function loadUpdaterToken() {
  const envToken = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
  if (envToken) {
    return envToken;
  }

  const tokenFilePaths = [
    path.join(process.resourcesPath, 'update-token.json'),
    path.join(__dirname, 'build', 'update-token.json')
  ];

  for (const tokenPath of tokenFilePaths) {
    if (fs.existsSync(tokenPath)) {
      try {
        const { token } = JSON.parse(fs.readFileSync(tokenPath, 'utf8'));
        if (token) {
          return token;
        }
      } catch (error) {
        console.error(`Failed to read updater token from ${tokenPath}:`, error);
      }
    }
  }

  return null;
}

const updaterToken = loadUpdaterToken();
if (updaterToken) {
  autoUpdater.requestHeaders = { Authorization: `token ${updaterToken}` };
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, 'electron', 'preload.js')
    }
  });

  // Remove the default menu to keep the app chrome clean
  Menu.setApplicationMenu(null);
  mainWindow.removeMenu();

  if (isDev) {
    mainWindow.loadURL(process.env.ELECTRON_START_URL || 'http://localhost:5173');
  } else {
    mainWindow.loadFile(path.join(__dirname, 'dist', 'index.html'));
  }

  mainWindow.webContents.on('did-finish-load', () => {
    if (app.isPackaged) {
      autoUpdater.checkForUpdatesAndNotify();
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

autoUpdater.autoDownload = true;
autoUpdater.autoInstallOnAppQuit = true;

autoUpdater.on('checking-for-update', () => {
  console.log('Checking for update...');
});

autoUpdater.on('update-available', (info) => {
  console.log(`Update available: ${info.version}`);
});

autoUpdater.on('update-not-available', () => {
  console.log('No updates available.');
});

autoUpdater.on('download-progress', (progressObj) => {
  const logMessage = [
    `Download speed: ${progressObj.bytesPerSecond}`,
    `Downloaded ${progressObj.percent.toFixed(2)}%`,
    `(${progressObj.transferred}/${progressObj.total})`
  ].join(' - ');
  console.log(logMessage);
});

autoUpdater.on('update-downloaded', (info) => {
  console.log(`Update downloaded: ${info.version}; quitting and installing...`);
  autoUpdater.quitAndInstall();
});

app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
