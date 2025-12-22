/// <reference types="vite/client" />

interface PdfEntry {
    name: string;
    path: string;
    mtimeMs: number;
}

interface Window {
    electronAPI?: {
        captureScreen: () => Promise<string>;
        listPdfs: (path: string) => Promise<PdfEntry[]>;
        readPdfBase64: (path: string) => Promise<string>;
        selectFolder: () => Promise<string | null>;
        updater: {
            checkForUpdates: () => Promise<any>;
            quitAndInstall: () => Promise<void>;
            onUpdateAvailable: (callback: (info: any) => void) => void;
            onUpdateDownloaded: (callback: (info: any) => void) => void;
            onUpdateProgress: (callback: (progress: any) => void) => void;
            onUpdateError: (callback: (err: string) => void) => void;
            onUpdateNotAvailable: (callback: (info: any) => void) => void;
            onUpdateChecking: (callback: () => void) => void;
        };
    };
    browserFiles?: Record<string, File>;
}
