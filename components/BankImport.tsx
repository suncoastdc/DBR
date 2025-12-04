import React, { useState } from 'react';
import { BankTransaction } from '../types';

interface BankImportProps {
  onImport: (transactions: BankTransaction[]) => void;
}

const BankImport: React.FC<BankImportProps> = ({ onImport }) => {
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

    // Detect headers roughly or just assume structure. 
    // For MVP, we'll try to find index of Date, Description, Amount.
    // If we can't find them, we default to 0, 1, 2.
    
    // We will skip the first row assuming it's header
    const dataLines = lines.slice(1);
    
    const parsed: BankTransaction[] = dataLines.map((line, idx) => {
      // Handle simple CSV splitting (doesn't handle quoted commas perfectly, but sufficient for standard bank exports)
      const cols = line.split(',').map(c => c.replace(/"/g, '').trim());
      
      // Heuristic: usually Date is col 0, Amount is last or near last.
      // Let's look for a date-like string
      let dateIdx = 0;
      let amountIdx = cols.length - 1;
      let descIdx = 1;

      // Try to improve parsing if user provides a specific format later, 
      // but for now, let's just grab the most likely columns.
      // Simple fallback:
      const dateStr = cols[0]; 
      const amountStr = cols[cols.length - 1]; // Often the last column is balance or amount. 
      // If the last column is Balance, amount is usually second to last.
      // Let's try to parse the last column as a float.
      let amount = parseFloat(amountStr.replace(/[^0-9.-]+/g,""));
      
      // If amount is NaN, try the previous column (sometimes last col is Balance)
      if (isNaN(amount) && cols.length > 2) {
         amount = parseFloat(cols[cols.length - 2].replace(/[^0-9.-]+/g,""));
      }
      
      return {
        id: `bank-${Date.now()}-${idx}`,
        date: formatDate(dateStr),
        description: cols[1] || 'Imported Transaction',
        amount: isNaN(amount) ? 0 : amount
      };
    }).filter(t => t.amount > 0); // We are looking for deposits only (credits)

    setPreview(parsed);
  };

  const formatDate = (raw: string): string => {
    // Attempt to convert MM/DD/YYYY to YYYY-MM-DD
    try {
      const parts = raw.split('/');
      if (parts.length === 3) {
        // Assume MM/DD/YYYY
        return `${parts[2]}-${parts[0].padStart(2, '0')}-${parts[1].padStart(2, '0')}`;
      }
      return new Date(raw).toISOString().split('T')[0];
    } catch {
      return new Date().toISOString().split('T')[0];
    }
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
