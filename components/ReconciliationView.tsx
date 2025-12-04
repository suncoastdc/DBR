import React, { useMemo, useState } from 'react';
import { DepositRecord, BankTransaction, ReconciliationStatus } from '../types';

interface ReconciliationViewProps {
  deposits: DepositRecord[];
  transactions: BankTransaction[];
}

const ReconciliationView: React.FC<ReconciliationViewProps> = ({ deposits, transactions }) => {
  const [expandedRow, setExpandedRow] = useState<string | null>(null);

  // Group data by date
  const reconciliationData = useMemo(() => {
    const dates = new Set([
      ...deposits.map(d => d.date),
      ...transactions.map(t => t.date)
    ]);
    
    const sortedDates = Array.from(dates).sort().reverse(); // Newest first

    return sortedDates.map(date => {
      const dayDeposits = deposits.filter(d => d.date === date);
      const dayTransactions = transactions.filter(t => t.date === date);
      
      const dentrixTotal = dayDeposits.reduce((acc, curr) => acc + curr.total, 0);
      const bankTotal = dayTransactions.reduce((acc, curr) => acc + curr.amount, 0);
      const difference = bankTotal - dentrixTotal;

      return {
        date,
        dentrixTotal,
        bankTotal,
        difference,
        matches: Math.abs(difference) < 0.05, // floating point tolerance
        depositRecordIds: dayDeposits.map(d => d.id),
        bankTransactionIds: dayTransactions.map(t => t.id),
        details: {
            deposits: dayDeposits,
            transactions: dayTransactions
        }
      };
    });
  }, [deposits, transactions]);

  const toggleRow = (date: string) => {
    setExpandedRow(expandedRow === date ? null : date);
  };

  return (
    <div className="space-y-6">
       <div className="flex justify-between items-center bg-white p-4 rounded-lg shadow-sm">
           <div>
               <h2 className="text-xl font-bold text-gray-800">Reconciliation Dashboard</h2>
               <p className="text-sm text-gray-500">Matching daily Dentrix totals with Bank Deposits.</p>
           </div>
           <div className="flex gap-4 text-sm">
               <div className="flex items-center"><span className="w-3 h-3 bg-green-100 border border-green-500 rounded-full mr-2"></span> Matched</div>
               <div className="flex items-center"><span className="w-3 h-3 bg-red-100 border border-red-500 rounded-full mr-2"></span> Discrepancy</div>
           </div>
       </div>

       <div className="bg-white shadow overflow-hidden rounded-lg">
           <table className="min-w-full divide-y divide-gray-200">
               <thead className="bg-gray-50">
                   <tr>
                       <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Date</th>
                       <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Dentrix Total</th>
                       <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Bank Total</th>
                       <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Difference</th>
                       <th className="px-6 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">Status</th>
                       <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Action</th>
                   </tr>
               </thead>
               <tbody className="bg-white divide-y divide-gray-200">
                   {reconciliationData.map((row) => (
                       <React.Fragment key={row.date}>
                           <tr className={`hover:bg-gray-50 transition-colors ${row.matches ? '' : 'bg-red-50/30'}`}>
                               <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">{row.date}</td>
                               <td className="px-6 py-4 whitespace-nowrap text-sm text-right text-gray-600">${row.dentrixTotal.toFixed(2)}</td>
                               <td className="px-6 py-4 whitespace-nowrap text-sm text-right text-gray-600">${row.bankTotal.toFixed(2)}</td>
                               <td className={`px-6 py-4 whitespace-nowrap text-sm text-right font-bold ${row.difference === 0 ? 'text-gray-400' : row.difference > 0 ? 'text-green-600' : 'text-red-600'}`}>
                                   {row.difference > 0 ? '+' : ''}{row.difference.toFixed(2)}
                               </td>
                               <td className="px-6 py-4 whitespace-nowrap text-center">
                                   {row.matches ? (
                                       <span className="px-2 inline-flex text-xs leading-5 font-semibold rounded-full bg-green-100 text-green-800">
                                           Matched
                                       </span>
                                   ) : (
                                       <span className="px-2 inline-flex text-xs leading-5 font-semibold rounded-full bg-red-100 text-red-800">
                                           Mismatch
                                       </span>
                                   )}
                               </td>
                               <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                                   <button 
                                       onClick={() => toggleRow(row.date)}
                                       className="text-blue-600 hover:text-blue-900 focus:outline-none"
                                   >
                                       {expandedRow === row.date ? 'Hide Details' : 'View Details'}
                                   </button>
                               </td>
                           </tr>
                           {expandedRow === row.date && (
                               <tr className="bg-gray-50">
                                   <td colSpan={6} className="px-6 py-4">
                                       <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                           {/* Dentrix Details */}
                                           <div className="bg-white border rounded p-4">
                                               <h4 className="font-bold text-gray-700 mb-2 border-b pb-1">Dentrix Breakdown</h4>
                                               {row.details.deposits.length === 0 ? (
                                                   <p className="text-sm text-gray-400 italic">No Dentrix records for this date.</p>
                                               ) : (
                                                   <div className="space-y-3">
                                                       {row.details.deposits.map(d => (
                                                           <div key={d.id} className="text-sm">
                                                               <div className="flex justify-between font-medium text-gray-800 bg-gray-100 p-1 rounded">
                                                                   <span>Slip Total:</span>
                                                                   <span>${d.total.toFixed(2)}</span>
                                                               </div>
                                                               <div className="pl-2 mt-1 space-y-1 text-gray-600 text-xs">
                                                                   <div className="flex justify-between"><span>Cash:</span> <span>${d.breakdown.cash.toFixed(2)}</span></div>
                                                                   <div className="flex justify-between"><span>Checks:</span> <span>${d.breakdown.checks.toFixed(2)}</span></div>
                                                                   <div className="flex justify-between"><span>Credit Cards:</span> <span>${d.breakdown.creditCards.toFixed(2)}</span></div>
                                                                   <div className="flex justify-between"><span>CareCredit:</span> <span>${d.breakdown.careCredit.toFixed(2)}</span></div>
                                                                   <div className="flex justify-between"><span>Ins. Checks:</span> <span>${d.breakdown.insuranceChecks.toFixed(2)}</span></div>
                                                               </div>
                                                               {d.sourceImage && (
                                                                  <div className="mt-2">
                                                                    <p className="text-xs text-gray-400 mb-1">Processed Image:</p>
                                                                    <img src={d.sourceImage} className="h-20 object-contain border rounded" alt="Slip" />
                                                                  </div>
                                                               )}
                                                           </div>
                                                       ))}
                                                   </div>
                                               )}
                                           </div>

                                           {/* Bank Details */}
                                           <div className="bg-white border rounded p-4">
                                               <h4 className="font-bold text-gray-700 mb-2 border-b pb-1">Bank Transactions</h4>
                                               {row.details.transactions.length === 0 ? (
                                                   <p className="text-sm text-gray-400 italic">No bank deposits for this date.</p>
                                               ) : (
                                                   <ul className="space-y-2">
                                                       {row.details.transactions.map(t => (
                                                           <li key={t.id} className="flex justify-between items-center text-sm border-b border-dashed border-gray-200 pb-1 last:border-0">
                                                               <span className="text-gray-600 truncate max-w-[200px]" title={t.description}>{t.description}</span>
                                                               <span className="font-medium text-green-600">+${t.amount.toFixed(2)}</span>
                                                           </li>
                                                       ))}
                                                   </ul>
                                               )}
                                           </div>
                                       </div>
                                       <div className="mt-4 text-xs text-gray-500 text-center">
                                            If credit cards settle on a later date, manual adjustment may be required in future versions.
                                       </div>
                                   </td>
                               </tr>
                           )}
                       </React.Fragment>
                   ))}
               </tbody>
           </table>
       </div>
    </div>
  );
};

export default ReconciliationView;
