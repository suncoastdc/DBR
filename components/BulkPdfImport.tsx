import React, { useEffect, useMemo, useState } from 'react';
import { DepositRecord, DepositBreakdown } from '../types';
import Redactor from './Redactor';
import { parseDepositSlip } from '../services/geminiService';
import { getApiKey } from '../services/settingsService';
import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist';
import workerSrc from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { ImportLog, loadImportLog, saveImportLog } from '../services/importLogService';

GlobalWorkerOptions.workerSrc = workerSrc;

interface BulkPdfImportProps {
  onSave: (record: DepositRecord) => void;
  onImportedDate?: (date: string) => void;
}

interface PdfEntry {
  name: string;
  path: string;
  fileDate?: string;
  pdfDate?: string;
  status: 'new' | 'imported' | 'mismatch';
}

const BulkPdfImport: React.FC<BulkPdfImportProps> = ({ onSave, onImportedDate }) => {
  const [folderPath, setFolderPath] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pdfs, setPdfs] = useState<PdfEntry[]>([]);
  const [importLog, setImportLog] = useState<ImportLog>(() => loadImportLog());
  const [selectedPdf, setSelectedPdf] = useState<PdfEntry | null>(null);
  const [pageImages, setPageImages] = useState<string[]>([]);
  const [selectedPageIndex, setSelectedPageIndex] = useState(0);
  const [redactImage, setRedactImage] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [selectedDate, setSelectedDate] = useState<string>('');
  const [conflictDate, setConflictDate] = useState<string | null>(null);
  const [conflictFiles, setConflictFiles] = useState<PdfEntry[]>([]);
  const [conflictPageSelections, setConflictPageSelections] = useState<Record<string, number>>({}); // path -> pageIndex
  const [conflictImages, setConflictImages] = useState<Record<string, string[]>>({}); // path -> images[]

  // Grouping logic
  const dateGroups = useMemo(() => {
    const groups: Record<string, PdfEntry[]> = {};
    const noDate: PdfEntry[] = [];

    pdfs.forEach(p => {
      const d = p.pdfDate || p.fileDate;
      if (d) {
        if (!groups[d]) groups[d] = [];
        groups[d].push(p);
      } else {
        noDate.push(p);
      }
    });
    return { groups, noDate };
  }, [pdfs]);

  const dateRangeStatus = useMemo(() => {
    if (!startDate || !endDate) return [];
    const days: { date: string; status: 'ok' | 'missing' | 'duplicate' | 'pending'; files: PdfEntry[] }[] = [];

    let current = new Date(startDate);
    const end = new Date(endDate);

    const fmt = (d: Date) => d.toISOString().split('T')[0];

    while (current <= end) {
      const dStr = fmt(current);
      const files = dateGroups.groups[dStr] || [];
      const isImported = files.some(f => importLog[f.path]);

      let status: 'ok' | 'missing' | 'duplicate' | 'pending' = 'missing';
      if (files.length === 0) {
        status = 'missing';
      } else if (isImported) {
        status = 'ok';
      } else if (files.length > 1) {
        status = 'duplicate';
      } else {
        status = 'pending';
      }

      days.push({ date: dStr, status, files });
      current.setDate(current.getDate() + 1);
    }
    return days;
  }, [startDate, endDate, dateGroups, importLog]);

  useEffect(() => {
    // Auto-load if folder already set
    if (folderPath) {
      handleScan();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleScan = async () => {
    if (!folderPath) {
      setError('Enter a folder path to scan (e.g., \\\\server\\share\\pdfs).');
      return;
    }
    setError(null);
    setLoading(true);
    try {
      const entries = await window.electronAPI?.listPdfs(folderPath);
      if (!entries) {
        setError('File system access unavailable.');
        setLoading(false);
        return;
      }
      const mapped: PdfEntry[] = entries.map((e) => {
        const fileDate = parseDateFromFilename(e.name) || toIsoDate(new Date(e.mtimeMs));
        const status = importLog[e.path] ? 'imported' : 'new';
        return { name: e.name, path: e.path, fileDate, status };
      });

      // Auto-set range based on files found
      const dates = mapped.map(m => m.fileDate).filter(Boolean) as string[];
      if (dates.length > 0) {
        dates.sort();
        // If current start/end are empty, or user wants auto-range, we just set them.
        // We'll prioritize the file range.
        setStartDate(dates[0]);
        setEndDate(dates[dates.length - 1]);
      }

      setPdfs(mapped.sort((a, b) => (b.fileDate || '').localeCompare(a.fileDate || '')));
    } catch (err: any) {
      console.error(err);
      setError(err?.message || 'Failed to read folder.');
    } finally {
      setLoading(false);
    }
  };

  const inspectPdfDate = async (entry: PdfEntry) => {
    try {
      const pdfTextDate = await extractPdfDate(entry.path);
      setPdfs((prev) =>
        prev.map((p) => (p.path === entry.path ? { ...p, pdfDate: pdfTextDate || undefined } : p)),
      );
    } catch (err) {
      console.warn('Failed to inspect pdf date', err);
    }
  };

  const handleSelectFiles = async () => {
    setError(null);
    setLoading(true);
    try {
      // @ts-ignore
      if (window.electronAPI?.selectFiles) {
        // @ts-ignore
        const files = await window.electronAPI.selectFiles();
        if (!files || files.length === 0) {
          setLoading(false);
          return;
        }

        const mapped: PdfEntry[] = files.map((e: any) => {
          const fileDate = parseDateFromFilename(e.name) || toIsoDate(new Date(e.mtimeMs));
          const status = importLog[e.path] ? 'imported' : 'new';
          return { name: e.name, path: e.path, fileDate, status };
        });

        // Merge and deduplicate
        setPdfs(prev => {
          const lookup = new Set(prev.map(p => p.path));
          const newItems = mapped.filter(m => !lookup.has(m.path));
          const result = [...prev, ...newItems];
          return result.sort((a, b) => (b.fileDate || '').localeCompare(a.fileDate || ''));
        });

        // Update range if needed
        const newDates = mapped.map(m => m.fileDate).filter(Boolean) as string[];
        if (newDates.length > 0) {
          newDates.sort();
          // Expand range to include new dates if they are outside current range
          if (!startDate || newDates[0] < startDate) setStartDate(newDates[0]);
          if (!endDate || newDates[newDates.length - 1] > endDate) setEndDate(newDates[newDates.length - 1]);
        }
      } else {
        // Browser fallback
        fileInputRef.current?.click();
      }
    } catch (err: any) {
      console.error(err);
      setError(err?.message || 'Failed to select files.');
    } finally {
      setLoading(false);
    }
  };

  const openPages = async (entry: PdfEntry) => {
    setSelectedPdf(entry);
    setPageImages([]);
    setSelectedPageIndex(0);
    setRedactImage(null);
    // Prefer PDF date, then file date
    setSelectedDate(entry.pdfDate || entry.fileDate || '');
    setError(null);
    try {
      const pages = await renderPdfPages(entry.path, 1000);
      setPageImages(pages);
      if (pages.length > 0) {
        setSelectedPageIndex(0);
      }
    } catch (err: any) {
      console.error(err);
      setError(err?.message || 'Failed to render PDF pages.');
    }
  };

  const handleRedactionComplete = async (redactedImageBase64: string) => {
    if (!selectedPdf) return;
    setIsProcessing(true);
    try {
      const result = await parseDepositSlip(redactedImageBase64);
      const compressed = await compressDataUrl(redactedImageBase64, 400, 0.6);
      const assignedDate = selectedDate || result.date;
      if (!assignedDate) {
        alert('Select a date before saving this day sheet.');
        setIsProcessing(false);
        return;
      }
      const record: DepositRecord = {
        id: crypto.randomUUID(),
        date: assignedDate,
        total: result.total || 0,
        breakdown: (result.breakdown || {}) as DepositBreakdown,
        status: 'pending',
        sourceImage: compressed,
      };
      onSave(record);
      markImported(selectedPdf, assignedDate);
      setSelectedPdf(null);
      setPageImages([]);
      setSelectedPageIndex(0);
      setRedactImage(null);
      setSelectedDate('');
      openNextPending();
    } catch (err) {
      console.error('Processing failed', err);
      alert('Failed to process page. Please ensure API key is set and try again.');
    } finally {
      setIsProcessing(false);
    }
  };


  const fileInputRef = React.useRef<HTMLInputElement>(null);

  const handleBrowserFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files?.length) return;

    // In browser mode, we can't get the full folder path easily for display,
    // so we'll just use the first file's path relative to the selected directory if possible,
    // or just a placeholder.
    // Actually, e.target.files items have 'webkitRelativePath'.
    // We can infer the top level folder name from that.
    const files = Array.from(e.target.files).filter(f => f.name.toLowerCase().endsWith('.pdf'));
    if (files.length === 0) {
      setError('No PDF files found in selected folder.');
      return;
    }

    const first = files[0];
    const folderName = first.webkitRelativePath.split('/')[0] || 'Selected Folder';
    setFolderPath(folderName);

    setLoading(true);
    setError(null);

    try {
      // Create PdfEntry objects from File objects
      // Note: We need a way to read the file content later. 
      // The 'path' in our PdfEntry is usually an absolute path for Electron to read.
      // For browser files, we can't store the File object in the ID easily if we expect 'path' to be a string key.
      // BUT, we can use a temporary object URL or just keep the File object in memory.
      // However, our existing code expects 'path' to be a string key for importLog and electronAPI calls.

      // Adaptation:
      // 1. We'll use the 'webkitRelativePath' as the unique 'path' identifier for the browser session.
      // 2. We need to override 'extractPdfDate' and 'renderPdfPages' to handle these browser files 
      //    if window.electronAPI is missing.

      // Let's store the File objects in a ref or state so we can access them by their 'path' (webkitRelativePath).
      window.browserFiles = {}; // Hack for global access in helper functions, or better: use a state/ref accessible to helpers?
      // Helpers are outside the component.
      // We might need to move helpers inside or pass the file map to them.
      // For least impact, let's attach to window or a module-level var.

      files.forEach(f => {
        if (!window.browserFiles) window.browserFiles = {};
        window.browserFiles[f.webkitRelativePath] = f;
      });

      const entryMap: PdfEntry[] = files.map(f => {
        const pathKey = f.webkitRelativePath; // unique id for us
        const fileDate = parseDateFromFilename(f.name) || toIsoDate(new Date(f.lastModified));
        const status = importLog[pathKey] ? 'imported' : 'new';
        return { name: f.name, path: pathKey, fileDate, status };
      });

      // Auto-set range
      const dates = entryMap.map(m => m.fileDate).filter(Boolean) as string[];
      if (dates.length > 0) {
        dates.sort();
        setStartDate(dates[0]);
        setEndDate(dates[dates.length - 1]);
      }

      setPdfs(entryMap.sort((a, b) => (b.fileDate || '').localeCompare(a.fileDate || '')));

    } catch (err: any) {
      console.error(err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const pickFolder = async () => {
    if (window.electronAPI) {
      const selected = await window.electronAPI.selectFolder();
      if (selected) {
        setFolderPath(selected);
        // Electron flow will trigger handleScan via useEffect when folderPath changes
      }
    } else {
      // Browser fallback
      fileInputRef.current?.click();
    }
  };

  const markImported = (entry: PdfEntry, assignedDate?: string) => {
    const nextLog = {
      ...importLog,
      [entry.path]: { date: assignedDate || entry.fileDate || '', importedAt: new Date().toISOString() },
    };
    setImportLog(nextLog);
    saveImportLog(nextLog);
    if (assignedDate || entry.fileDate) {
      onImportedDate?.(assignedDate || entry.fileDate);
    }
    setPdfs((prev) => prev.map((p) => (p.path === entry.path ? { ...p, status: 'imported' } : p)));
  };

  const clearImported = () => {
    if (window.confirm('Clear imported log?')) {
      setImportLog({});
      saveImportLog({});
      setPdfs((prev) => prev.map((p) => ({ ...p, status: 'new' })));
    }
  };

  const openNextPending = () => {
    // Find first day that is pending or duplicate
    const nextDay = dateRangeStatus.find(d => d.status === 'pending' || d.status === 'duplicate');

    if (!nextDay) {
      // Fallback to searching loose list if date range not set
      const loose = pdfs.find(p => !importLog[p.path] && (!p.fileDate || !startDate));
      if (loose) openPages(loose);
      return;
    }

    if (nextDay.status === 'duplicate') {
      startConflictResolution(nextDay.date, nextDay.files);
    } else if (nextDay.files[0]) {
      openPages(nextDay.files[0]);
    }
  };

  const startConflictResolution = async (date: string, files: PdfEntry[]) => {
    setConflictDate(date);
    setConflictFiles(files);
    setConflictPageSelections({});
    setConflictImages({});
    setIsProcessing(true);

    // Pre-load images for all conflict files (page 1) or all pages? 
    // Let's load first 5 pages for each to be safe for finding totals
    const imageMap: Record<string, string[]> = {};
    try {
      for (const f of files) {
        imageMap[f.path] = await renderPdfPages(f.path, 800);
      }
      setConflictImages(imageMap);
    } catch (e) {
      setError('Failed to load images for comparison.');
    } finally {
      setIsProcessing(false);
    }
  };

  const resolveConflict = (winner: PdfEntry) => {
    // Set winner as active
    const pageIndex = conflictPageSelections[winner.path] || 0;
    const images = conflictImages[winner.path] || [];

    setConflictDate(null);
    setConflictFiles([]);

    setSelectedPdf(winner);
    setPageImages(images);
    setSelectedPageIndex(pageIndex);
    setSelectedDate(winner.pdfDate || winner.fileDate || '');
  };

  if (!getApiKey()) {
    return (
      <div className="max-w-3xl mx-auto p-6 bg-yellow-50 border border-yellow-200 rounded">
        <h2 className="text-lg font-semibold text-yellow-800 mb-2">Set your API key first</h2>
        <p className="text-sm text-yellow-700">Open Settings and add your API key to process PDFs.</p>
      </div>
    );
  }

  if (redactImage) {
    return (
      <Redactor
        imageSrc={redactImage}
        onProcess={handleRedactionComplete}
        onCancel={() => setRedactImage(null)}
      />
    );
  }

  return (
    <div className="max-w-6xl mx-auto p-6 bg-white dark:bg-gray-800 shadow rounded-lg transition-colors duration-200">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-2xl font-bold text-gray-800 dark:text-white">Bulk Import Day Sheets (PDF)</h2>
          <p className="text-sm text-gray-500 dark:text-gray-400">Scans PDFs from a folder, checks dates, and lets you redact pages before AI.</p>
        </div>
        <div className="text-xs text-gray-600 dark:text-gray-300 bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded px-3 py-2 max-w-xs">
          <div className="font-semibold text-gray-800 dark:text-white mb-1">OCR status</div>
          <ul className="list-disc list-inside space-y-0.5">
            <li>PDF text is read locally to suggest the slip date.</li>
            <li>Redacted pages use Gemini Vision to OCR totals (online).</li>
          </ul>
        </div>
        <div className="text-right text-xs text-gray-600 dark:text-gray-400">
          <div className="font-semibold text-gray-700 dark:text-gray-200">Batch helper</div>
          <div>
            {dateRangeStatus.length > 0
              ? `${dateRangeStatus.filter(d => d.status === 'pending' || d.status === 'duplicate').length} days to review`
              : `${pdfs.filter(p => p.status !== 'imported').length} files pending`
            }
          </div>
          <button
            onClick={openNextPending}
            className="mt-1 text-blue-600 dark:text-blue-400 underline hover:text-blue-800 dark:hover:text-blue-300 disabled:text-gray-400 dark:disabled:text-gray-600"
            disabled={!dateRangeStatus.some(d => d.status === 'pending' || d.status === 'duplicate') && !pdfs.some(p => p.status === 'new')}
            type="button"
          >
            Open next pending
          </button>
        </div>
        <button onClick={clearImported} className="text-xs text-red-500 hover:text-red-700 dark:hover:text-red-400 underline">
          Clear imported log
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        <div className="md:col-span-2">
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Folder path (UNC or local)</label>
          {/* Hidden input for browser fallback */}
          <input
            type="file"
            ref={fileInputRef}
            style={{ display: 'none' }}
            onChange={handleBrowserFileSelect}
            // @ts-ignore
            directory=""
            webkitdirectory=""
            multiple
          />
          <div className="mt-1 flex gap-2">
            <input
              value={folderPath}
              onChange={(e) => setFolderPath(e.target.value)}
              placeholder="\\\\server\\share\\day-sheets"
              className="w-full border rounded px-3 py-2 dark:bg-gray-700 dark:border-gray-600 dark:text-white"
            />
            <button
              onClick={pickFolder}
              className="px-3 py-2 text-sm bg-gray-200 dark:bg-gray-600 hover:bg-gray-300 dark:hover:bg-gray-500 rounded text-gray-800 dark:text-white"
              type="button"
            >
              Browse
            </button>
          </div>
        </div>
        <div className="md:col-span-1 grid grid-cols-2 gap-2">
          <div>
            <label className="block text-xs text-gray-600 dark:text-gray-400">Start date</label>
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="mt-1 w-full border rounded px-3 py-2 dark:bg-gray-700 dark:border-gray-600 dark:text-white"
            />
          </div>
          <div>
            <label className="block text-xs text-gray-600 dark:text-gray-400">End date</label>
            <input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="mt-1 w-full border rounded px-3 py-2 dark:bg-gray-700 dark:border-gray-600 dark:text-white"
            />
          </div>
          <div className="col-span-2 text-[10px] text-gray-500 dark:text-gray-400 italic">
            Auto-populated when you scan. Adjust if needed.
          </div>
        </div>
      </div>

      <div className="flex items-center gap-3 mb-4">
        <button
          onClick={handleScan}
          disabled={loading}
          className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
        >
          {loading ? 'Scanning...' : 'Scan Folder'}
        </button>
        <span className="text-gray-400 dark:text-gray-500">or</span>
        <button
          onClick={handleSelectFiles}
          disabled={loading}
          className="px-4 py-2 bg-gray-600 text-white rounded hover:bg-gray-700 disabled:opacity-50"
        >
          Select Files
        </button>
        {error && <span className="text-sm text-red-600">{error}</span>}
      </div>

      {conflictDate && (
        <div className="mb-6 p-4 border border-yellow-300 bg-yellow-50 dark:bg-yellow-900/30 rounded">
          <div className="flex justify-between items-center mb-4">
            <div>
              <h3 className="text-lg font-bold text-yellow-800 dark:text-yellow-200">Resolving Conflict: {conflictDate}</h3>
              <p className="text-sm text-yellow-700 dark:text-yellow-300">Multiple files detected for this date. Compare totals and select the correct one.</p>
            </div>
            <button
              onClick={() => { setConflictDate(null); setConflictFiles([]); }}
              className="text-sm text-yellow-800 dark:text-yellow-200 underline"
            >
              Cancel
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {conflictFiles.map(file => {
              const images = conflictImages[file.path] || [];
              const pageIdx = conflictPageSelections[file.path] || 0;
              const hasImages = images.length > 0;

              return (
                <div key={file.path} className="border border-yellow-200 dark:border-yellow-700 rounded bg-white dark:bg-gray-800 p-3 shadow-sm">
                  <div className="font-semibold text-sm mb-2 break-all">{file.name}</div>
                  <div className="h-[300px] bg-gray-100 dark:bg-gray-900 mb-2 flex items-center justify-center overflow-hidden rounded relative">
                    {hasImages ? (
                      <img src={images[pageIdx]} alt="Preview" className="max-h-full object-contain" />
                    ) : (
                      <span className="text-xs text-gray-400">Loading preview...</span>
                    )}

                    {hasImages && (
                      <div className="absolute bottom-2 left-0 right-0 flex justify-center gap-2">
                        <button
                          onClick={() => setConflictPageSelections(prev => ({ ...prev, [file.path]: Math.max(0, pageIdx - 1) }))}
                          disabled={pageIdx === 0}
                          className="px-2 py-0.5 bg-black/50 text-white rounded text-xs disabled:opacity-30"
                        >
                          Prev
                        </button>
                        <span className="text-xs bg-black/50 text-white px-2 rounded">{pageIdx + 1} / {images.length}</span>
                        <button
                          onClick={() => {
                            setConflictPageSelections(prev => ({ ...prev, [file.path]: Math.min(images.length - 1, pageIdx + 1) }))
                          }}
                          disabled={pageIdx === images.length - 1}
                          className="px-2 py-0.5 bg-black/50 text-white rounded text-xs disabled:opacity-30"
                        >
                          Next
                        </button>
                      </div>
                    )}
                  </div>
                  <button
                    onClick={() => resolveConflict(file)}
                    className="w-full py-2 bg-indigo-600 text-white rounded text-sm hover:bg-indigo-700 font-medium"
                  >
                    Select This Version
                  </button>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {dateRangeStatus.length === 0 && !loading && pdfs.length === 0 && (
        <p className="text-gray-500 dark:text-gray-400 text-sm">No PDFs found. Select a folder to scan.</p>
      )}

      {(dateRangeStatus.length > 0 || pdfs.length > 0) && !conflictDate && (
        <div className="overflow-auto border dark:border-gray-600 rounded max-h-[500px]">
          <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700 text-sm">
            <thead className="bg-gray-50 dark:bg-gray-700 sticky top-0 z-10">
              <tr>
                <th className="px-3 py-2 text-left font-semibold text-gray-600 dark:text-gray-300">Date</th>
                <th className="px-3 py-2 text-left font-semibold text-gray-600 dark:text-gray-300">Status</th>
                <th className="px-3 py-2 text-left font-semibold text-gray-600 dark:text-gray-300">Files</th>
                <th className="px-3 py-2 text-right font-semibold text-gray-600 dark:text-gray-300">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200 dark:divide-gray-700 bg-white dark:bg-gray-800">
              {/* Render Date Range Rows first */}
              {dateRangeStatus.map((day) => (
                <tr key={day.date} className={day.status === 'missing' ? 'bg-red-50 dark:bg-red-900/20' : day.status === 'duplicate' ? 'bg-yellow-50 dark:bg-yellow-900/20' : ''}>
                  <td className="px-3 py-2 font-medium text-gray-800 dark:text-white sticky left-0 bg-inherit">{day.date}</td>
                  <td className="px-3 py-2">
                    {day.status === 'missing' && <span className="text-red-600 text-xs font-bold uppercase">Missing</span>}
                    {day.status === 'duplicate' && <span className="text-yellow-600 text-xs font-bold uppercase">Conflict ({day.files.length})</span>}
                    {day.status === 'ok' && <span className="text-green-600 text-xs font-bold uppercase">Imported</span>}
                    {day.status === 'pending' && <span className="text-gray-500 text-xs font-bold uppercase">Pending</span>}
                  </td>
                  <td className="px-3 py-2 text-xs text-gray-600 dark:text-gray-400">
                    {day.files.map(f => (
                      <div key={f.path} className="truncate max-w-[200px]" title={f.name}>• {f.name}</div>
                    ))}
                    {day.files.length === 0 && <span className="italic text-gray-400">No matching files</span>}
                  </td>
                  <td className="px-3 py-2 text-right">
                    {day.status === 'duplicate' && (
                      <button
                        onClick={() => startConflictResolution(day.date, day.files)}
                        className="text-xs bg-yellow-100 text-yellow-800 px-2 py-1 rounded hover:bg-yellow-200 border border-yellow-300"
                      >
                        Resolve
                      </button>
                    )}
                    {day.status === 'pending' && day.files[0] && (
                      <button
                        onClick={() => openPages(day.files[0])}
                        className="text-xs bg-indigo-50 text-indigo-700 px-2 py-1 rounded hover:bg-indigo-100 border border-indigo-200"
                      >
                        Import
                      </button>
                    )}
                  </td>
                </tr>
              ))}

              {/* Show loose files not mapped to the range (if any) */}
              {dateRangeStatus.length === 0 && pdfs.map((pdf) => (
                <tr key={pdf.path}>
                  <td className="px-3 py-2 text-gray-800 dark:text-white">
                    {pdf.fileDate || <span className="text-gray-400 italic">Unknown</span>}
                  </td>
                  <td className="px-3 py-2">
                    {importLog[pdf.path] ? <span className="text-green-600 text-xs font-bold">Imported</span> : <span className="text-gray-500 text-xs font-bold">Pending</span>}
                  </td>
                  <td className="px-3 py-2 text-xs text-gray-600 dark:text-gray-400">
                    {pdf.name}
                    {!pdf.fileDate && (
                      <button onClick={() => inspectPdfDate(pdf)} className="ml-2 text-blue-500 hover:underline">
                        Scan content
                      </button>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right">
                    <button
                      onClick={() => openPages(pdf)}
                      className="text-xs bg-indigo-50 text-indigo-700 px-2 py-1 rounded hover:bg-indigo-100 border border-indigo-200"
                    >
                      Import
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {selectedPdf && pageImages.length > 0 && (
        <div className="mt-6">
          <div className="flex items-center justify-between mb-3">
            <div>
              <h3 className="text-lg font-semibold text-gray-800 dark:text-white">{selectedPdf.name}</h3>
              <p className="text-xs text-gray-500 dark:text-gray-400">
                Choose the page with totals, redact PHI, and confirm the posting date.
              </p>
            </div>
            <button onClick={() => { setSelectedPdf(null); setPageImages([]); }} className="text-sm text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300">
              Close
            </button>
          </div>
          <div className="mb-4 grid grid-cols-1 md:grid-cols-3 gap-3 items-end">
            <div className="md:col-span-2 text-sm text-gray-600 dark:text-gray-300 bg-blue-50 dark:bg-blue-900/30 border border-blue-100 dark:border-blue-900 px-3 py-2 rounded">
              <p className="font-semibold text-blue-800 dark:text-blue-200">How to use</p>
              <ul className="list-disc list-inside text-blue-800 dark:text-blue-200">
                <li>Select the page thumbnail that shows the totals by payment type.</li>
                <li>Use the large preview to double-check before redacting.</li>
                <li>Redact patient details on the next screen before sending to AI.</li>
                <li>Confirm the date below so the system remembers this day sheet.</li>
              </ul>
            </div>
            <div>
              <label className="block text-xs text-gray-600 dark:text-gray-400">Assign to date</label>
              <input
                type="date"
                value={selectedDate}
                onChange={(e) => setSelectedDate(e.target.value)}
                className="mt-1 w-full border rounded px-3 py-2 dark:bg-gray-700 dark:border-gray-600 dark:text-white"
              />
              <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-1">Defaults to PDF or file date.</p>
            </div>
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
            <div className="lg:col-span-3">
              <div className="border border-gray-200 dark:border-gray-600 rounded bg-gray-50 dark:bg-gray-800 p-3 flex flex-col gap-3">
                <div className="flex items-center justify-between text-sm text-gray-600 dark:text-gray-300">
                  <span>
                    Page {selectedPageIndex + 1} of {pageImages.length}
                  </span>
                  <div className="space-x-2">
                    <button
                      type="button"
                      onClick={() => setSelectedPageIndex((prev) => Math.max(0, prev - 1))}
                      disabled={selectedPageIndex === 0}
                      className="px-2 py-1 bg-white dark:bg-gray-700 border dark:border-gray-600 rounded disabled:opacity-50 dark:text-white"
                    >
                      Prev
                    </button>
                    <button
                      type="button"
                      onClick={() => setSelectedPageIndex((prev) => Math.min(pageImages.length - 1, prev + 1))}
                      disabled={selectedPageIndex === pageImages.length - 1}
                      className="px-2 py-1 bg-white dark:bg-gray-700 border dark:border-gray-600 rounded disabled:opacity-50 dark:text-white"
                    >
                      Next
                    </button>
                  </div>
                </div>
                <div className="bg-white dark:bg-gray-900 border dark:border-gray-700 rounded shadow-sm overflow-hidden flex justify-center">
                  <img
                    src={pageImages[selectedPageIndex]}
                    alt={`Page ${selectedPageIndex + 1}`}
                    className="max-h-[520px] object-contain"
                  />
                </div>
                <div className="flex justify-end">
                  <button
                    onClick={() => setRedactImage(pageImages[selectedPageIndex])}
                    className="px-4 py-2 bg-indigo-600 text-white rounded hover:bg-indigo-700"
                  >
                    Redact selected page
                  </button>
                </div>
              </div>
            </div>
            <div className="lg:col-span-2 max-h-[620px] overflow-auto border dark:border-gray-600 rounded p-2">
              <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                {pageImages.map((img, idx) => (
                  <button
                    key={idx}
                    onClick={() => setSelectedPageIndex(idx)}
                    className={`border dark:border-gray-600 rounded shadow-sm overflow-hidden bg-white dark:bg-gray-700 text-left transition ${idx === selectedPageIndex ? 'ring-2 ring-indigo-500' : 'hover:shadow-md'
                      }`}
                  >
                    <img src={img} alt={`Page ${idx + 1}`} className="w-full object-contain max-h-48 bg-gray-50 dark:bg-gray-900" />
                    <div className="px-3 py-2 text-xs font-medium text-gray-700 dark:text-gray-300">Page {idx + 1}</div>
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {isProcessing && (
        <div className="mt-4 text-sm text-blue-700">Processing page with AI...</div>
      )}
    </div>
  );
};

export default BulkPdfImport;

function parseDateFromFilename(name: string): string | undefined {
  const base = name.replace('.pdf', '');

  // 1. Try ISO YYYY-MM-DD
  const iso = base.match(/(20\d{2})[-_.](\d{2})[-_.](\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;

  // 2. Try US MM-DD-YYYY
  const us = base.match(/(\d{2})[-_.](\d{2})[-_.](\d{4})/);
  if (us) return `${us[3]}-${us[1]}-${us[2]}`;

  // 3. Try compact YYYYMMDD (must be 8 digits, reasonable year)
  // Avoid matching random 8-digit numbers unless they look like dates (202x...)
  const compact = base.match(/(20\d{2})(\d{2})(\d{2})/);
  if (compact) {
    // Basic validation to avoid false positives like "20230099"
    const m = parseInt(compact[2], 10);
    const d = parseInt(compact[3], 10);
    if (m >= 1 && m <= 12 && d >= 1 && d <= 31) {
      return `${compact[1]}-${compact[2]}-${compact[3]}`;
    }
  }

  // 4. Try 6-digit MMDDYY or DDMMYY (ambiguous, but often MMDDYY in US)
  // Only if explicitly 6 digits or separated? Let's be careful.

  return undefined;
}

function toIsoDate(d: Date): string {
  return d.toISOString().split('T')[0];
}

async function extractPdfDate(filePath: string): Promise<string | null> {
  let bytes: Uint8Array;

  if (window.electronAPI) {
    const base64 = await window.electronAPI.readPdfBase64(filePath);
    if (!base64) return null;
    bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
  } else {
    // Browser fallback
    const file = window.browserFiles?.[filePath];
    if (!file) return null;
    const arrayBuffer = await file.arrayBuffer();
    bytes = new Uint8Array(arrayBuffer);
  }

  const pdf = await getDocument({ data: bytes }).promise;
  const page = await pdf.getPage(1);
  const text = await page.getTextContent();
  const combined = text.items.map((i: any) => i.str).join(' ');
  const match = combined.match(/(\d{4})[-/](\d{2})[-/](\d{2})/);
  if (match) return `${match[1]}-${match[2]}-${match[3]}`;
  const alt = combined.match(/(\d{2})[-/](\d{2})[-/](\d{4})/);
  if (alt) return `${alt[3]}-${alt[1]}-${alt[2]}`;
  return null;
}

async function renderPdfPages(filePath: string, maxWidth = 1000): Promise<string[]> {
  let bytes: Uint8Array;

  if (window.electronAPI) {
    const base64 = await window.electronAPI.readPdfBase64(filePath);
    if (!base64) return [];
    bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
  } else {
    // Browser fallback
    const file = window.browserFiles?.[filePath];
    if (!file) return [];
    const arrayBuffer = await file.arrayBuffer();
    bytes = new Uint8Array(arrayBuffer);
  }

  const pdf = await getDocument({ data: bytes }).promise;
  const pages: string[] = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const viewport = page.getViewport({ scale: 1 });
    const scale = Math.min(1, maxWidth / viewport.width);
    const renderViewport = page.getViewport({ scale });
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');
    canvas.width = renderViewport.width;
    canvas.height = renderViewport.height;
    await page.render({ canvasContext: context as any, viewport: renderViewport }).promise;
    pages.push(canvas.toDataURL('image/png'));
  }
  return pages;
}

// Downscale/compress data URLs to keep localStorage usage low.
function compressDataUrl(dataUrl: string, maxSize = 400, quality = 0.6): Promise<string> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, maxSize / Math.max(img.width, img.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(img.width * scale));
      canvas.height = Math.max(1, Math.round(img.height * scale));
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        resolve(dataUrl);
        return;
      }
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      try {
        const jpeg = canvas.toDataURL('image/jpeg', quality);
        resolve(jpeg);
      } catch {
        resolve(dataUrl);
      }
    };
    img.onerror = () => resolve(dataUrl);
    img.src = dataUrl;
  });
}
