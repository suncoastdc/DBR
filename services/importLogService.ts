const IMPORT_LOG_KEY = 'dbr_imported_pdfs';

type ImportFileType = 'day_sheet_pdf' | 'bank_csv' | 'bank_pdf';

export interface ImportLogEntry {
  date: string;
  importedAt: string;
  fileName?: string;
  sourceMachine?: string;
  fileType?: ImportFileType;
  recordCount?: number;
  fileHash?: string;
}

export type ImportLog = Record<string, ImportLogEntry>;

export function loadImportLog(): ImportLog {
  try {
    const raw = localStorage.getItem(IMPORT_LOG_KEY);
    if (!raw) return {};
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

export function saveImportLog(log: ImportLog) {
  localStorage.setItem(IMPORT_LOG_KEY, JSON.stringify(log));
}

export function getImportedDates(log: ImportLog): Set<string> {
  return new Set(
    Object.values(log)
      .filter((entry) => !entry.fileType || entry.fileType === 'day_sheet_pdf')
      .map((entry) => entry.date)
      .filter(Boolean),
  );
}

export async function getSourceMachineName(): Promise<string> {
  const stored = localStorage.getItem('dbr_machine_name');
  if (stored) return stored;

  if (window.electronAPI?.getDeviceName) {
    const name = await window.electronAPI.getDeviceName();
    if (name) {
      localStorage.setItem('dbr_machine_name', name);
      return name;
    }
  }

  const generated = `device-${createMachineId()}`;
  localStorage.setItem('dbr_machine_name', generated);
  return generated;
}

export async function hashBuffer(buffer: ArrayBuffer): Promise<string> {
  if (!crypto?.subtle) return '';
  const digest = await crypto.subtle.digest('SHA-256', buffer);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

export function buildImportLogKey(fileType: ImportFileType, fileName: string, fileHash?: string) {
  if (fileHash) {
    return `${fileType}:${fileHash}`;
  }
  return `${fileType}:${fileName}:${new Date().toISOString()}`;
}

function createMachineId(): string {
  if (crypto?.randomUUID) {
    return crypto.randomUUID();
  }
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}
