import { contextBridge, desktopCapturer, screen } from 'electron';
import fs from 'node:fs/promises';
import path from 'node:path';
import { ipcRenderer } from 'electron';

const captureScreen = async () => {
  const primary = screen.getPrimaryDisplay();
  const { width, height, scaleFactor } = primary;

  const sources = await desktopCapturer.getSources({
    types: ['screen'],
    thumbnailSize: {
      width: Math.floor(width * scaleFactor),
      height: Math.floor(height * scaleFactor),
    },
  });

  const source = sources[0];
  if (!source) {
    throw new Error('No screens available for capture');
  }

  return source.thumbnail.toDataURL();
};

contextBridge.exposeInMainWorld('electronAPI', {
  captureScreen,
  listPdfs: async (folderPath) => {
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
    const data = await fs.readFile(filePath);
    return data.toString('base64');
  },
  selectFolder: async () => {
    return ipcRenderer.invoke('select-folder');
  },
});
