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

  const filteredPdfs = useMemo(() => {
    if (!startDate || !endDate) return pdfs;
    const start = new Date(startDate);
    const end = new Date(endDate);
    return pdfs.filter((p) => {
      if (!p.fileDate) return false;
      const d = new Date(p.fileDate);
      return d >= start && d <= end;
    });
  }, [pdfs, startDate, endDate]);

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
      const status: PdfEntry['status'] =
        importLog[entry.path] ? 'imported' : pdfTextDate && entry.fileDate && pdfTextDate !== entry.fileDate ? 'mismatch' : 'new';
      setPdfs((prev) =>
        prev.map((p) => (p.path === entry.path ? { ...p, pdfDate: pdfTextDate || undefined, status } : p)),
      );
    } catch (err) {
      console.warn('Failed to inspect pdf date', err);
    }
  };

  const openPages = async (entry: PdfEntry) => {
    setSelectedPdf(entry);
    setPageImages([]);
    setSelectedPageIndex(0);
    setRedactImage(null);
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

  const pickFolder = async () => {
    const selected = await window.electronAPI?.selectFolder();
    if (selected) {
      setFolderPath(selected);
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

  const nextPending = () => filteredPdfs.find((p) => p.status !== 'imported');

  const openNextPending = () => {
    const next = nextPending();
    if (next) {
      openPages(next);
    }
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
    <div className="max-w-6xl mx-auto p-6 bg-white shadow rounded-lg">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-2xl font-bold text-gray-800">Bulk Import Day Sheets (PDF)</h2>
          <p className="text-sm text-gray-500">Scans PDFs from a folder, checks dates, and lets you redact pages before AI.</p>
        </div>
        <div className="text-xs text-gray-600 bg-gray-50 border border-gray-200 rounded px-3 py-2 max-w-xs">
          <div className="font-semibold text-gray-800 mb-1">OCR status</div>
          <ul className="list-disc list-inside space-y-0.5">
            <li>PDF text is read locally to suggest the slip date.</li>
            <li>Redacted pages use Gemini Vision to OCR totals (online).</li>
          </ul>
        </div>
        <div className="text-right text-xs text-gray-600">
          <div className="font-semibold text-gray-700">Batch helper</div>
          <div>{filteredPdfs.filter((p) => p.status !== 'imported').length} remaining in range</div>
          <button
            onClick={openNextPending}
            className="mt-1 text-blue-600 underline hover:text-blue-800 disabled:text-gray-400"
            disabled={!nextPending()}
            type="button"
          >
            Open next pending
          </button>
        </div>
        <button onClick={clearImported} className="text-xs text-red-500 hover:text-red-700 underline">
          Clear imported log
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        <div className="md:col-span-2">
          <label className="block text-sm font-medium text-gray-700">Folder path (UNC or local)</label>
          <div className="mt-1 flex gap-2">
            <input
              value={folderPath}
              onChange={(e) => setFolderPath(e.target.value)}
              placeholder="\\\\server\\share\\day-sheets"
              className="w-full border rounded px-3 py-2"
            />
            <button
              onClick={pickFolder}
              className="px-3 py-2 text-sm bg-gray-200 hover:bg-gray-300 rounded"
              type="button"
            >
              Browse
            </button>
          </div>
        </div>
        <div className="md:col-span-1 grid grid-cols-2 gap-2">
          <div>
            <label className="block text-xs text-gray-600">Start date</label>
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="mt-1 w-full border rounded px-3 py-2"
            />
          </div>
          <div>
            <label className="block text-xs text-gray-600">End date</label>
            <input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="mt-1 w-full border rounded px-3 py-2"
            />
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
        {error && <span className="text-sm text-red-600">{error}</span>}
      </div>

      {filteredPdfs.length === 0 && !loading && (
        <p className="text-gray-500 text-sm">No PDFs found in range.</p>
      )}

      {filteredPdfs.length > 0 && (
        <div className="overflow-auto border rounded max-h-[420px]">
          <table className="min-w-full divide-y divide-gray-200 text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-3 py-2 text-left font-semibold text-gray-600">File</th>
                <th className="px-3 py-2 text-left font-semibold text-gray-600">File Date</th>
                <th className="px-3 py-2 text-left font-semibold text-gray-600">PDF Date</th>
                <th className="px-3 py-2 text-left font-semibold text-gray-600">Saved Date</th>
                <th className="px-3 py-2 text-left font-semibold text-gray-600">Status</th>
                <th className="px-3 py-2 text-right font-semibold text-gray-600">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {filteredPdfs.map((pdf) => (
                <tr key={pdf.path} className={pdf.status === 'mismatch' ? 'bg-yellow-50' : ''}>
                  <td className="px-3 py-2 font-medium text-gray-800">{pdf.name}</td>
                  <td className="px-3 py-2 text-gray-700">{pdf.fileDate || '—'}</td>
                  <td className="px-3 py-2 text-gray-700">
                    {pdf.pdfDate || (
                      <button
                        className="text-blue-600 underline text-xs"
                        onClick={() => inspectPdfDate(pdf)}
                      >
                        Read
                      </button>
                    )}
                  </td>
                  <td className="px-3 py-2 text-gray-700">
                    {importLog[pdf.path]?.date || '—'}
                  </td>
                  <td className="px-3 py-2">
                    {pdf.status === 'imported' && <span className="text-green-600 font-semibold">Imported</span>}
                    {pdf.status === 'mismatch' && <span className="text-yellow-700 font-semibold">Mismatch</span>}
                    {pdf.status === 'new' && <span className="text-gray-600">Pending</span>}
                  </td>
                  <td className="px-3 py-2 text-right space-x-2">
                    <button
                      onClick={() => openPages(pdf)}
                      className="px-3 py-1 bg-indigo-600 text-white rounded hover:bg-indigo-700 text-xs"
                    >
                      Select pages
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
              <h3 className="text-lg font-semibold text-gray-800">{selectedPdf.name}</h3>
              <p className="text-xs text-gray-500">
                Choose the page with totals, redact PHI, and confirm the posting date.
              </p>
            </div>
            <button onClick={() => { setSelectedPdf(null); setPageImages([]); }} className="text-sm text-gray-500 hover:text-gray-700">
              Close
            </button>
          </div>
          <div className="mb-4 grid grid-cols-1 md:grid-cols-3 gap-3 items-end">
            <div className="md:col-span-2 text-sm text-gray-600 bg-blue-50 border border-blue-100 px-3 py-2 rounded">
              <p className="font-semibold text-blue-800">How to use</p>
              <ul className="list-disc list-inside text-blue-800">
                <li>Select the page thumbnail that shows the totals by payment type.</li>
                <li>Use the large preview to double-check before redacting.</li>
                <li>Redact patient details on the next screen before sending to AI.</li>
                <li>Confirm the date below so the system remembers this day sheet.</li>
              </ul>
            </div>
            <div>
              <label className="block text-xs text-gray-600">Assign to date</label>
              <input
                type="date"
                value={selectedDate}
                onChange={(e) => setSelectedDate(e.target.value)}
                className="mt-1 w-full border rounded px-3 py-2"
              />
              <p className="text-[11px] text-gray-500 mt-1">Defaults to PDF or file date.</p>
            </div>
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
            <div className="lg:col-span-3">
              <div className="border rounded bg-gray-50 p-3 flex flex-col gap-3">
                <div className="flex items-center justify-between text-sm text-gray-600">
                  <span>
                    Page {selectedPageIndex + 1} of {pageImages.length}
                  </span>
                  <div className="space-x-2">
                    <button
                      type="button"
                      onClick={() => setSelectedPageIndex((prev) => Math.max(0, prev - 1))}
                      disabled={selectedPageIndex === 0}
                      className="px-2 py-1 bg-white border rounded disabled:opacity-50"
                    >
                      Prev
                    </button>
                    <button
                      type="button"
                      onClick={() => setSelectedPageIndex((prev) => Math.min(pageImages.length - 1, prev + 1))}
                      disabled={selectedPageIndex === pageImages.length - 1}
                      className="px-2 py-1 bg-white border rounded disabled:opacity-50"
                    >
                      Next
                    </button>
                  </div>
                </div>
                <div className="bg-white border rounded shadow-sm overflow-hidden flex justify-center">
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
            <div className="lg:col-span-2 max-h-[620px] overflow-auto border rounded p-2">
              <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                {pageImages.map((img, idx) => (
                  <button
                    key={idx}
                    onClick={() => setSelectedPageIndex(idx)}
                    className={`border rounded shadow-sm overflow-hidden bg-white text-left transition ${
                      idx === selectedPageIndex ? 'ring-2 ring-indigo-500' : 'hover:shadow-md'
                    }`}
                  >
                    <img src={img} alt={`Page ${idx + 1}`} className="w-full object-contain max-h-48 bg-gray-50" />
                    <div className="px-3 py-2 text-xs font-medium text-gray-700">Page {idx + 1}</div>
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
  // YYYY-MM-DD or YYYYMMDD
  const iso = base.match(/(\d{4})[-_]?(\d{2})[-_]?(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  // MM-DD-YYYY
  const us = base.match(/(\d{2})[-_](\d{2})[-_](\d{4})/);
  if (us) return `${us[3]}-${us[1]}-${us[2]}`;
  return undefined;
}

function toIsoDate(d: Date): string {
  return d.toISOString().split('T')[0];
}

async function extractPdfDate(filePath: string): Promise<string | null> {
  const base64 = await window.electronAPI?.readPdfBase64(filePath);
  if (!base64) return null;
  const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
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
  const base64 = await window.electronAPI?.readPdfBase64(filePath);
  if (!base64) return [];
  const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
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
