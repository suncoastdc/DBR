const { contextBridge, ipcRenderer } = require('electron');
const os = require('node:os');
let fs;
let path;
try {
  fs = require('node:fs/promises');
  path = require('node:path');
} catch (err) {
  console.error('Failed to load fs/path in preload:', err);
}

const captureScreen = async () => ipcRenderer.invoke('capture-screen');
const safeInvoke = (channel, ...args) => ipcRenderer.invoke(channel, ...args);

contextBridge.exposeInMainWorld('electronAPI', {
  captureScreen,
  listPdfs: async (folderPath) => {
    if (!fs || !path) return [];
    const entries = await fs.readdir(folderPath, { withFileTypes: true });
    const pdfs = [];
    for (const entry of entries) {
      if (entry.isFile() && entry.name.toLowerCase().endsWith('.pdf')) {
        const fullPath = path.join(folderPath, entry.name);
        const stat = await fs.stat(fullPath);
        pdfs.push({
          name: entry.name,
          path: fullPath,
          mtimeMs: stat.mtimeMs,
        });
      }
    }
    return pdfs;
  },
  readPdfBase64: async (filePath) => {
    if (!fs) return '';
    const data = await fs.readFile(filePath);
    return data.toString('base64');
  },
  selectFolder: async () => {
    return safeInvoke('select-folder');
  },
  selectFiles: async () => {
    const paths = await safeInvoke('select-files');
    if (!paths) return [];
    const results = [];
    for (const p of paths) {
      try {
        if (!fs || !path) return [];
        const stat = await fs.stat(p);
        results.push({
          name: path.basename(p),
          path: p,
          mtimeMs: stat.mtimeMs,
        });
      } catch (e) {
        console.error('Failed to stat file', p, e);
      }
    }
    return results;
  },
  getDeviceName: () => os.hostname(),
  // Updater APIs
  updater: {
    checkForUpdates: () => safeInvoke('check-for-updates'),
    quitAndInstall: () => safeInvoke('quit-and-install'),
    onUpdateAvailable: (callback) => ipcRenderer.on('update-available', (_, info) => callback(info)),
    onUpdateDownloaded: (callback) => ipcRenderer.on('update-downloaded', (_, info) => callback(info)),
    onUpdateProgress: (callback) => ipcRenderer.on('download-progress', (_, progress) => callback(progress)),
    onUpdateError: (callback) => ipcRenderer.on('update-error', (_, err) => callback(err)),
    onUpdateNotAvailable: (callback) => ipcRenderer.on('update-not-available', (_, info) => callback(info)),
    onUpdateChecking: (callback) => ipcRenderer.on('update-checking', () => callback()),
  },
});
