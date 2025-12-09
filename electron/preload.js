import { contextBridge, desktopCapturer, screen } from 'electron';

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
});
