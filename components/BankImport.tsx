import React, { useEffect, useState } from 'react';
import { BankTransaction } from '../types';
import {
  inferPaymentType,
  loadPaymentRules,
  PaymentRule,
  PaymentTypeKey,
  RuleSuggestion,
  createPatternFromDescription,
  suggestRulesFromTransactions,
  upsertPaymentRule,
} from '../services/paymentRulesService';

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

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const text = event.target?.result as string;
      parseCSV(text);
    };
    reader.readAsText(file);
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
    const descriptionIdx = findIndex(['description', 'name', 'memo', 'details']);
    const creditIdx = findIndex(['credit', 'deposit', 'amount cr', 'amount (cr)']);
    const debitIdx = findIndex(['debit', 'withdrawal', 'amount dr', 'amount (dr)']);
    const amountIdx = findIndex(['amount']);

    const parsed: BankTransaction[] = dataLines.map((line, idx) => {
      const cols = splitCsvLine(line).map(c => c.replace(/\"/g, '').trim());

      const dateStr = getColumn(cols, dateIdx, 0);
      const description = getColumn(cols, descriptionIdx, 1) || 'Imported Transaction';

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
    }).filter(t => t.amount > 0) // We are looking for deposits only (credits)
      .sort((a, b) => a.date.localeCompare(b.date));

    const existingSignatures = new Set(existingTransactions.map(tx => buildSignature(tx)));
    const unique: BankTransaction[] = [];

    parsed.forEach(tx => {
      const signature = buildSignature(tx);
      if (existingSignatures.has(signature)) return;
      if (unique.some(item => buildSignature(item) === signature)) return;
      unique.push(tx);
    });

    const decorated = applyRules(unique, paymentRules);
    setPreview(decorated);
  };

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

  const handleConfirm = () => {
    onImport(preview);
    setPreview([]);
  };

  return (
    <div className="max-w-4xl mx-auto p-6 bg-white shadow rounded-lg">
      <h2 className="text-2xl font-bold mb-4 text-gray-800">Import Bank Statement</h2>
      <p className="mb-4 text-gray-600">Upload a CSV file from your bank. We will filter for deposits (positive amounts).</p>
      
      {!preview.length && (
        <div className="border-2 border-dashed border-gray-300 p-8 text-center rounded bg-gray-50">
          <input type="file" accept=".csv" onChange={handleFileUpload} className="mb-2" />
          <p className="text-xs text-gray-500">Supported formats: CSV (Date, Description, Amount)</p>
        </div>
      )}

      {preview.length > 0 && (
        <div className="mt-6">
          <div className="flex justify-between items-center mb-2">
            <h3 className="font-bold text-lg">{preview.length} Deposits Found</h3>
            <div className="space-x-2">
                <button onClick={() => setPreview([])} className="px-4 py-2 text-gray-600 hover:text-gray-800">Cancel</button>
                <button onClick={handleConfirm} className="px-6 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 font-medium">Import Transactions</button>
            </div>
          </div>
          <div className="overflow-auto max-h-96 border rounded">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50 sticky top-0">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Date</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Description</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Payment type</th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Amount</th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {preview.map((tx) => (
                  <tr key={tx.id}>
                    <td className="px-6 py-2 whitespace-nowrap text-sm text-gray-900">{tx.date}</td>
                    <td className="px-6 py-2 whitespace-nowrap text-sm text-gray-500">{tx.description}</td>
                    <td className="px-6 py-2 whitespace-nowrap text-sm">
                      <div className="flex flex-col gap-2">
                        <div className="flex items-center gap-2">
                          <select
                            className="border rounded px-2 py-1 text-sm"
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
                            className="text-xs text-indigo-700 underline disabled:text-gray-400"
                            type="button"
                            disabled={!tx.paymentType}
                            onClick={() => handleSaveRuleFromRow(tx)}
                          >
                            Save rule
                          </button>
                        </div>
                        <p className="text-[11px] text-gray-400">
                          {tx.paymentType
                            ? `Tagged as ${paymentTypeLabel(tx.paymentType)} — save as a rule to reuse for matching descriptions.`
                            : 'No rule yet'}
                        </p>
                      </div>
                    </td>
                    <td className="px-6 py-2 whitespace-nowrap text-sm text-right font-medium text-green-600">
                      ${tx.amount.toFixed(2)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="mt-4 bg-blue-50 border border-blue-100 rounded p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <h4 className="font-semibold text-blue-900">Teach payment types faster</h4>
                <p className="text-xs text-blue-800">We look for repeat bank descriptions and propose a mapping.</p>
              </div>
              <span className="text-[11px] text-blue-700">{paymentRules.length} rules saved</span>
            </div>

            {ruleSuggestions.length === 0 && (
              <p className="text-sm text-blue-700">No new descriptions to learn from in this import.</p>
            )}

            {ruleSuggestions.length > 0 && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {ruleSuggestions.map((s) => (
                  <div key={s.pattern} className="bg-white rounded border border-blue-100 p-3 shadow-sm">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="text-sm font-semibold text-gray-800">{s.pattern}</p>
                        <p className="text-[11px] text-gray-500">Seen {s.count} time(s) in this file</p>
                      </div>
                      <div className="text-[11px] text-gray-500">Suggested: {paymentTypeLabel(s.suggestedType)}</div>
                    </div>
                    <div className="mt-2 flex items-center gap-2">
                      <select
                        className="border rounded px-2 py-1 text-sm"
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
