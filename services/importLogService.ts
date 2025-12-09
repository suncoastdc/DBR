const IMPORT_LOG_KEY = 'dbr_imported_pdfs';

export interface ImportLogEntry {
  date: string;
  importedAt: string;
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
  return new Set(Object.values(log).map((v) => v.date));
}
