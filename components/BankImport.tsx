import React, { useEffect, useState } from 'react';
import * as pdfjsLib from 'pdfjs-dist';
import workerSrc from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { BankTransaction } from '../types';
import { parseBankStatementPage } from '../services/geminiService';
import { buildImportLogKey, getSourceMachineName, hashBuffer, loadImportLog, saveImportLog } from '../services/importLogService';
import {
  createPatternFromDescription,
  inferPaymentType,
  loadPaymentRules,
  PaymentRule,
  PaymentTypeKey,
  RuleSuggestion,
  suggestRulesFromTransactions,
  upsertPaymentRule,
} from '../services/paymentRulesService';

pdfjsLib.GlobalWorkerOptions.workerSrc = workerSrc;


interface BankImportProps {
  onImport: (transactions: BankTransaction[]) => void;
  existingTransactions: BankTransaction[];
}

const normalizeDescription = (value: string) => value.replace(/\s+/g, ' ').trim().toLowerCase();
const buildSignature = (tx: Pick<BankTransaction, 'date' | 'description' | 'amount'>) =>
  `${tx.date}|${normalizeDescription(tx.description)}|${tx.amount.toFixed(2)}`;

const BankImport: React.FC<BankImportProps> = ({ onImport, existingTransactions }) => {
  const [preview, setPreview] = useState<BankTransaction[]>([]);
  const [paymentRules, setPaymentRules] = useState<PaymentRule[]>(() => loadPaymentRules());
  const [ruleSuggestions, setRuleSuggestions] = useState<RuleSuggestion[]>([]);
  const [suggestionSelections, setSuggestionSelections] = useState<Record<string, PaymentTypeKey | ''>>({});
  const [processingStatus, setProcessingStatus] = useState<{ current: number; total: number } | null>(null);
  const [pendingImportMeta, setPendingImportMeta] = useState<{
    fileName: string;
    fileType: 'bank_csv' | 'bank_pdf';
    fileHash?: string;
  } | null>(null);


  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const arrayBuffer = await file.arrayBuffer();
    const fileHash = await hashBuffer(arrayBuffer);
    const text = await file.text();
    setPendingImportMeta({ fileName: file.name, fileType: 'bank_csv', fileHash });
    parseCSV(text);
  };

  // Simple heuristics based CSV parser
  const parseCSV = (text: string) => {
    setPreview([]);

    const lines = text.split(/\r?\n/).filter(line => line.trim() !== '');
    if (lines.length < 2) return;

    const headers = splitCsvLine(lines[0]).map(h => h.replace(/\"/g, '').trim());
    const lowerHeaders = headers.map(h => h.toLowerCase());
    const dataLines = lines.slice(1);

    const findIndex = (candidates: string[]) =>
      lowerHeaders.findIndex(h => candidates.some(c => h.includes(c)));

    const dateIdx = findIndex(['date', 'post date', 'posting date']);

    // Explicit amount columns
    const creditIdx = findIndex(['credit', 'deposit', 'amount cr', 'amount (cr)']);
    const debitIdx = findIndex(['debit', 'withdrawal', 'amount dr', 'amount (dr)']);
    const amountIdx = findIndex(['amount']);
    const balanceIdx = findIndex(['balance', 'running bal']);

    // Indices to EXCLUDE from description
    const excludedIndices = new Set([dateIdx, creditIdx, debitIdx, amountIdx, balanceIdx].filter(i => i !== -1));

    const parsed: BankTransaction[] = dataLines.map((line, idx) => {
      const cols = splitCsvLine(line).map(c => c.replace(/\"/g, '').trim());

      const dateStr = getColumn(cols, dateIdx, 0);

      // Construct description from ALL non-excluded columns
      const descriptionParts: string[] = [];
      cols.forEach((col, colIdx) => {
        if (!excludedIndices.has(colIdx) && col) {
          descriptionParts.push(col);
        }
      });

      const description = descriptionParts.join(' ') || 'Imported Transaction';

      const rawCredit = creditIdx !== -1 ? cols[creditIdx] : undefined;
      const rawDebit = debitIdx !== -1 ? cols[debitIdx] : undefined;
      const rawAmount = amountIdx !== -1 ? cols[amountIdx] : undefined;

      let amount = parseMoney(rawCredit ?? rawAmount ?? '');
      if (!amount && rawDebit) {
        amount = -parseMoney(rawDebit);
      }

      return {
        id: `bank-${Date.now()}-${idx}`,
        date: formatDate(dateStr),
        description,
        amount: amount || 0
      };
    }).sort((a, b) => a.date.localeCompare(b.date));

    processRawTransactions(parsed);
  };

  function processRawTransactions(rawTransactions: BankTransaction[]) {
    // We used to filter for deposits here, but now we keep all transactions
    // The Reconciliation view will handle filtering for matching.
    const transactions = rawTransactions.sort((a, b) => a.date.localeCompare(b.date));

    const existingSignatures = new Set(existingTransactions.map(tx => buildSignature(tx)));
    const unique: BankTransaction[] = [];

    transactions.forEach(tx => {
      const signature = buildSignature(tx);
      if (existingSignatures.has(signature)) return;
      if (unique.some(item => buildSignature(item) === signature)) return;
      unique.push(tx);
    });

    const decorated = applyRules(unique, paymentRules);
    setPreview(decorated);
  }





  const applyRules = (transactions: BankTransaction[], rules: PaymentRule[]) =>
    transactions.map((tx) => ({ ...tx, paymentType: inferPaymentType(tx.description, rules) }));

  const refreshSuggestions = (transactions: BankTransaction[], rules: PaymentRule[]) => {
    const nextSuggestions = suggestRulesFromTransactions(transactions, rules);
    setRuleSuggestions(nextSuggestions);
    const seeded: Record<string, PaymentTypeKey | ''> = {};
    nextSuggestions.forEach((s) => {
      if (s.suggestedType) seeded[s.pattern] = s.suggestedType;
    });
    setSuggestionSelections(seeded);
  };

  useEffect(() => {
    refreshSuggestions(preview, paymentRules);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preview, paymentRules]);

  const handleSaveRule = (suggestion: RuleSuggestion) => {
    const chosen = suggestionSelections[suggestion.pattern] || suggestion.suggestedType;
    if (!chosen) {
      alert('Pick a payment type before saving this rule.');
      return;
    }
    const updatedRules = upsertPaymentRule(suggestion.pattern, chosen, 'learned');
    setPaymentRules(updatedRules);
    const updatedPreview = applyRules(preview, updatedRules);
    setPreview(updatedPreview);
  };

  const updatePaymentType = (id: string, type: PaymentTypeKey | '') => {
    const next = preview.map((tx) => (tx.id === id ? { ...tx, paymentType: type || undefined } : tx));
    setPreview(next);
  };

  const handleSaveRuleFromRow = (tx: BankTransaction) => {
    if (!tx.paymentType) {
      alert('Select a payment type first.');
      return;
    }

    const pattern = createPatternFromDescription(tx.description);
    if (!pattern) {
      alert('Could not derive a reusable pattern from this description.');
      return;
    }

    const updatedRules = upsertPaymentRule(pattern, tx.paymentType, 'manual');
    setPaymentRules(updatedRules);
    const updatedPreview = applyRules(preview, updatedRules);
    setPreview(updatedPreview);
  };

  const paymentTypeLabel = (type?: PaymentTypeKey) => {
    if (!type) return 'Unmapped';
    return {
      cash: 'Cash',
      checks: 'Checks',
      insuranceChecks: 'Insurance checks',
      creditCards: 'Credit cards',
      careCredit: 'CareCredit',
      cherry: 'Cherry',
      eft: 'ACH / EFT',
      other: 'Other',
    }[type];
  };

  const splitCsvLine = (line: string): string[] => {
    const cells: string[] = [];
    let current = '';
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      const nextChar = line[i + 1];

      if (char === '"') {
        if (inQuotes && nextChar === '"') {
          current += '"';
          i++; // skip escaped quote
        } else {
          inQuotes = !inQuotes;
        }
      } else if (char === ',' && !inQuotes) {
        cells.push(current);
        current = '';
      } else {
        current += char;
      }
    }

    cells.push(current);
    return cells;
  };

  const getColumn = (cols: string[], idx: number, fallback: number) => {
    return cols[idx !== -1 ? idx : fallback] || '';
  };

  const parseMoney = (value: string | undefined): number => {
    if (!value) return 0;
    const normalized = value.includes('(') && value.includes(')')
      ? `-${value}`
      : value;
    const cleaned = normalized.replace(/[^0-9.-]/g, '');
    const amount = parseFloat(cleaned);
    return isNaN(amount) ? 0 : amount;
  };

  const formatDate = (raw: string): string => {
    const value = raw.trim();
    const today = new Date().toISOString().split('T')[0];

    if (!value) return today;

    const slashParts = value.split('/');
    if (slashParts.length === 3) {
      const [m, d, y] = slashParts;
      const year = y.length === 2 ? `20${y}` : y;
      return `${year.padStart(4, '0')}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
    }

    const dashParts = value.split('-');
    if (dashParts.length === 3 && dashParts[0].length === 4) {
      const [year, month, day] = dashParts;
      return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
    }

    const parsed = new Date(value);
    if (!isNaN(parsed.getTime())) {
      return parsed.toISOString().split('T')[0];
    }

    return today;
  };

  const handleConfirm = async () => {
    onImport(preview);
    if (pendingImportMeta) {
      const importedAt = new Date().toISOString();
      const sourceMachine = await getSourceMachineName();
      const key = buildImportLogKey(pendingImportMeta.fileType, pendingImportMeta.fileName, pendingImportMeta.fileHash);
      const log = loadImportLog();
      log[key] = {
        date: preview[0]?.date || importedAt.split('T')[0],
        importedAt,
        fileName: pendingImportMeta.fileName,
        sourceMachine,
        fileType: pendingImportMeta.fileType,
        recordCount: preview.length,
        fileHash: pendingImportMeta.fileHash,
      };
      saveImportLog(log);
    }
    setPreview([]);
    setPendingImportMeta(null);
  };


  const handlePdfUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setProcessingStatus({ current: 0, total: 1 }); // Indeterminate initially
    setPreview([]);

    try {
      const arrayBuffer = await file.arrayBuffer();
      const fileHash = await hashBuffer(arrayBuffer);
      const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer });
      const pdf = await loadingTask.promise;

      setProcessingStatus({ current: 0, total: pdf.numPages });

      const allTransactions: BankTransaction[] = [];

      for (let i = 1; i <= pdf.numPages; i++) {
        setProcessingStatus({ current: i, total: pdf.numPages });

        // Render page to image
        const page = await pdf.getPage(i);
        const viewport = page.getViewport({ scale: 1.5 }); // Good quality for OCR
        const canvas = document.createElement('canvas');
        const context = canvas.getContext('2d');
        if (!context) continue;

        canvas.height = viewport.height;
        canvas.width = viewport.width;

        await page.render({ canvasContext: context, viewport }).promise;
        const base64 = canvas.toDataURL('image/png');

        // Send to Gemini
        const pageTxs = await parseBankStatementPage(base64);

        // Map to BankTransaction
        const mapped: BankTransaction[] = pageTxs.map((pt, idx) => ({
          id: `pdf-${Date.now()}-${i}-${idx}`,
          date: pt.date,
          description: pt.description,
          amount: pt.amount
        }));

        allTransactions.push(...mapped);
      }

      setPendingImportMeta({ fileName: file.name, fileType: 'bank_pdf', fileHash });
      processRawTransactions(allTransactions);

    } catch (err: any) {
      console.error(err);
      alert('Failed to process PDF: ' + err.message);
    } finally {
      setProcessingStatus(null);
    }
  };


  return (
    <div className="max-w-4xl mx-auto p-6 bg-white dark:bg-gray-800 shadow rounded-lg transition-colors duration-200">
      <h2 className="text-2xl font-bold mb-4 text-gray-800 dark:text-white">Import Bank Statement</h2>
      <p className="mb-4 text-gray-600 dark:text-gray-300">Upload a CSV or PDF file from your bank. All transactions will be imported.</p>

      {!preview.length && !processingStatus && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="border-2 border-dashed border-gray-300 dark:border-gray-600 p-8 text-center rounded bg-gray-50 dark:bg-gray-700 transition-colors">
            <h3 className="font-semibold text-gray-700 dark:text-gray-200 mb-2">CSV Upload</h3>
            <input type="file" accept=".csv" onChange={handleFileUpload} className="mb-2 dark:text-gray-300 text-sm" />
            <p className="text-xs text-gray-500 dark:text-gray-400">Date, Description, Amount</p>
          </div>

          <div className="border-2 border-dashed border-blue-300 dark:border-blue-700 p-8 text-center rounded bg-blue-50 dark:bg-blue-900/20 transition-colors">
            <h3 className="font-semibold text-blue-800 dark:text-blue-200 mb-2">PDF Upload (AI)</h3>
            <input type="file" accept=".pdf" onChange={handlePdfUpload} className="mb-2 dark:text-gray-300 text-sm" />
            <p className="text-xs text-blue-600 dark:text-blue-300">Scans pages for transactions</p>
          </div>
        </div>
      )}

      {processingStatus && (
        <div className="border rounded p-8 text-center bg-gray-50 dark:bg-gray-800">
          <div className="animate-spin h-8 w-8 border-4 border-blue-500 border-t-transparent rounded-full mx-auto mb-4"></div>
          <p className="text-gray-700 dark:text-gray-200 font-medium">Processing Page {processingStatus.current} of {processingStatus.total}...</p>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-2">Using AI to read bank statement transactions.</p>
        </div>
      )}


      {preview.length > 0 && (
        <div className="mt-6">
          <div className="flex justify-between items-center mb-2">
            <h3 className="font-bold text-lg dark:text-white">{preview.length} Transactions Found</h3>
            <div className="space-x-2">
              <button
                onClick={() => {
                  setPreview([]);
                  setPendingImportMeta(null);
                }}
                className="px-4 py-2 text-gray-600 dark:text-gray-300 hover:text-gray-800 dark:hover:text-white"
              >
                Cancel
              </button>
              <button onClick={handleConfirm} className="px-6 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 font-medium">Import Transactions</button>
            </div>
          </div>
          <div className="overflow-auto max-h-96 border dark:border-gray-600 rounded">
            <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
              <thead className="bg-gray-50 dark:bg-gray-700">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Date</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Description</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Payment type</th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Amount</th>
                </tr>
              </thead>
              <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
                {preview.map((tx) => (
                  <tr key={tx.id}>
                    <td className="px-6 py-2 whitespace-nowrap text-sm text-gray-900 dark:text-white">{tx.date}</td>
                    <td className="px-6 py-2 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400">{tx.description}</td>
                    <td className="px-6 py-2 whitespace-nowrap text-sm">
                      <div className="flex flex-col gap-2">
                        <div className="flex items-center gap-2">
                          <select
                            className="border dark:border-gray-600 rounded px-2 py-1 text-sm bg-white dark:bg-gray-700 dark:text-white"
                            value={tx.paymentType || ''}
                            onChange={(e) => updatePaymentType(tx.id, e.target.value as PaymentTypeKey)}
                          >
                            <option value="">Pick type</option>
                            <option value="cash">Cash</option>
                            <option value="checks">Checks</option>
                            <option value="insuranceChecks">Insurance checks</option>
                            <option value="creditCards">Credit cards</option>
                            <option value="careCredit">CareCredit</option>
                            <option value="cherry">Cherry</option>
                            <option value="eft">ACH / EFT</option>
                            <option value="other">Other</option>
                          </select>
                          <button
                            className="text-xs text-indigo-700 dark:text-indigo-400 underline disabled:text-gray-400 dark:disabled:text-gray-600"
                            type="button"
                            disabled={!tx.paymentType}
                            onClick={() => handleSaveRuleFromRow(tx)}
                          >
                            Save rule
                          </button>
                        </div>
                        <p className="text-[11px] text-gray-400 dark:text-gray-500">
                          {tx.paymentType
                            ? `Tagged as ${paymentTypeLabel(tx.paymentType)} — save as a rule to reuse for matching descriptions.`
                            : 'No rule yet'}
                        </p>
                      </div>
                    </td>
                    <td className={`px-6 py-2 whitespace-nowrap text-sm text-right font-medium ${tx.amount >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>
                      {tx.amount >= 0 ? '+' : ''}{tx.amount.toFixed(2)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="mt-4 bg-blue-50 dark:bg-blue-900/40 border border-blue-100 dark:border-blue-800 rounded p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <h4 className="font-semibold text-blue-900 dark:text-blue-100">Teach payment types faster</h4>
                <p className="text-xs text-blue-800 dark:text-blue-200">We look for repeat bank descriptions and propose a mapping.</p>
              </div>
              <span className="text-[11px] text-blue-700 dark:text-blue-300">{paymentRules.length} rules saved</span>
            </div>

            {ruleSuggestions.length === 0 && (
              <p className="text-sm text-blue-700 dark:text-blue-300">No new descriptions to learn from in this import.</p>
            )}

            {ruleSuggestions.length > 0 && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {ruleSuggestions.map((s) => (
                  <div key={s.pattern} className="bg-white dark:bg-gray-800 rounded border border-blue-100 dark:border-blue-900 p-3 shadow-sm">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="text-sm font-semibold text-gray-800 dark:text-gray-200">{s.pattern}</p>
                        <p className="text-[11px] text-gray-500 dark:text-gray-400">Seen {s.count} time(s) in this file</p>
                      </div>
                      <div className="text-[11px] text-gray-500 dark:text-gray-400">Suggested: {paymentTypeLabel(s.suggestedType)}</div>
                    </div>
                    <div className="mt-2 flex items-center gap-2">
                      <select
                        className="border dark:border-gray-600 rounded px-2 py-1 text-sm bg-white dark:bg-gray-700 dark:text-white"
                        value={suggestionSelections[s.pattern] || ''}
                        onChange={(e) =>
                          setSuggestionSelections((prev) => ({ ...prev, [s.pattern]: e.target.value as PaymentTypeKey }))
                        }
                      >
                        <option value="">Pick type</option>
                        <option value="cash">Cash</option>
                        <option value="checks">Checks</option>
                        <option value="insuranceChecks">Insurance checks</option>
                        <option value="creditCards">Credit cards</option>
                        <option value="careCredit">CareCredit</option>
                        <option value="cherry">Cherry</option>
                        <option value="eft">ACH / EFT</option>
                        <option value="other">Other</option>
                      </select>
                      <button
                        onClick={() => handleSaveRule(s)}
                        className="px-3 py-1 bg-indigo-600 text-white text-sm rounded hover:bg-indigo-700 disabled:opacity-60"
                        disabled={!suggestionSelections[s.pattern] && !s.suggestedType}
                        type="button"
                      >
                        Save rule & tag matches
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default BankImport;
