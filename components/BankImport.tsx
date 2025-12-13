import React, { useState } from 'react';
import { BankTransaction } from '../types';

interface BankImportProps {
  onImport: (transactions: BankTransaction[]) => void;
  existingTransactions: BankTransaction[];
}

const normalizeDescription = (value: string) => value.replace(/\s+/g, ' ').trim().toLowerCase();
const buildSignature = (tx: Pick<BankTransaction, 'date' | 'description' | 'amount'>) =>
  `${tx.date}|${normalizeDescription(tx.description)}|${tx.amount.toFixed(2)}`;

const BankImport: React.FC<BankImportProps> = ({ onImport, existingTransactions }) => {
  const [csvText, setCsvText] = useState<string>('');
  const [preview, setPreview] = useState<BankTransaction[]>([]);
  
  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const text = event.target?.result as string;
      setCsvText(text);
      parseCSV(text);
    };
    reader.readAsText(file);
  };

  // Simple heuristics based CSV parser
  const parseCSV = (text: string) => {
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

    setPreview(unique);
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
    setCsvText('');
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
                  <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Amount</th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {preview.map((tx) => (
                  <tr key={tx.id}>
                    <td className="px-6 py-2 whitespace-nowrap text-sm text-gray-900">{tx.date}</td>
                    <td className="px-6 py-2 whitespace-nowrap text-sm text-gray-500">{tx.description}</td>
                    <td className="px-6 py-2 whitespace-nowrap text-sm text-right font-medium text-green-600">
                      ${tx.amount.toFixed(2)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};

export default BankImport;
