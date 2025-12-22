import React, { useMemo, useState } from 'react';
import { DepositRecord, BankTransaction } from '../types';
import CalendarStatus from './CalendarStatus';

interface ReconciliationViewProps {
    deposits: DepositRecord[];
    transactions: BankTransaction[];
    viewScope: 'year' | 'month';
    selectedDate: Date;
    onSelectMonth: (date: Date) => void;
    onBackToYear: () => void;
    datesWithSheets: Set<string>;
    onDeleteDeposit?: (id: string) => void;
}

const ReconciliationView: React.FC<ReconciliationViewProps> = ({
    deposits,
    transactions,
    viewScope,
    selectedDate,
    onSelectMonth,
    onBackToYear,
    datesWithSheets,
    onDeleteDeposit
}) => {
    const [expandedRow, setExpandedRow] = useState<string | null>(null);
    const [enlargedImage, setEnlargedImage] = useState<string | null>(null);

    // --- Year Summary Calculation ---
    const yearSummary = useMemo(() => {
        if (viewScope !== 'year') return [];

        const year = selectedDate.getFullYear();

        return Array.from({ length: 12 }, (_, i) => {
            const jsMonth = i; // 0-11
            // Filter data for this month
            const monthDeposits = deposits.filter(d => {
                const dt = new Date(d.date);
                return dt.getFullYear() === year && dt.getMonth() === jsMonth;
            });

            const monthTxs = transactions.filter(t => {
                const dt = new Date(t.date);
                // Only consider DEPOSITS for reconciliation totals
                return t.amount > 0 && dt.getFullYear() === year && dt.getMonth() === jsMonth;
            });

            const totalDentrix = monthDeposits.reduce((sum, d) => sum + d.total, 0);
            const totalBank = monthTxs.reduce((sum, t) => sum + t.amount, 0);
            const diff = totalBank - totalDentrix;

            let status: 'green' | 'orange' | 'red' = 'red';
            if (monthDeposits.length === 0 && monthTxs.length === 0) {
                status = 'red'; // Not Started / Empty
            } else if (Math.abs(diff) < 1.0) { // Tolerance
                status = 'green'; // Balanced
            } else {
                status = 'orange'; // Processed but discrepancy
            }

            return {
                date: new Date(year, jsMonth, 1),
                monthName: new Date(year, jsMonth, 1).toLocaleString('default', { month: 'long' }),
                totalDentrix,
                totalBank,
                diff,
                status,
                count: monthDeposits.length + monthTxs.length
            };
        });
    }, [deposits, transactions, viewScope, selectedDate]);

    // --- Month Detail Calculation (Fuzzy Matching) ---
    const reconciliationData = useMemo(() => {
        if (viewScope !== 'month') return [];

        const targetYear = selectedDate.getFullYear();
        const targetMonth = selectedDate.getMonth();

        // 1. Filter Deposits for this month
        const monthDeposits = deposits.filter(d => {
            const dt = new Date(d.date);
            return dt.getFullYear() === targetYear && dt.getMonth() === targetMonth;
        }).sort((a, b) => a.date.localeCompare(b.date)); // Oldest first

        // 2. Get ALL relevant transactions (this month + next 2 months for overlap)
        // We need a wider pool for the "look forward" matching
        const poolTransactions = transactions.filter(t => {
            const dt = new Date(t.date);
            // Simple optimization: only take transactions >= 1st of this month
            // We can optimize further but this is safe
            // Only consider DEPOSITS for matching
            return t.amount > 0 && dt >= new Date(targetYear, targetMonth, 1);
        }).sort((a, b) => a.date.localeCompare(b.date)); // Oldest first for deterministic matching

        // Tracking matched transaction IDs to avoid double counting
        const matchedTransactionIds = new Set<string>();

        // 3. Perform Matching Logic
        const rows: any[] = [];

        // A. Match Deposits first
        monthDeposits.forEach(deposit => {
            // Find best candidate: 
            // - Exact Amount Match
            // - Bank Date >= Deposit Date
            // - Bank Date <= Deposit Date + 45 days
            // - Not already matched

            const candidate = poolTransactions.find(t => {
                if (matchedTransactionIds.has(t.id)) return false;

                // Diff check (using small epsilon for float safety, though exact is preferred)
                if (Math.abs(t.amount - deposit.total) > 0.02) return false;

                // Date check
                if (t.date < deposit.date) return false; // Happened before deposit

                const dDate = new Date(deposit.date);
                const tDate = new Date(t.date);
                const diffTime = Math.abs(tDate.getTime() - dDate.getTime());
                const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

                return diffDays <= 45;
            });

            if (candidate) {
                matchedTransactionIds.add(candidate.id);
                rows.push({
                    date: deposit.date,
                    displayDate: deposit.date,
                    dentrixTotal: deposit.total,
                    bankTotal: candidate.amount,
                    difference: candidate.amount - deposit.total, // Should be ~0
                    matches: true,
                    depositRecordIds: [deposit.id],
                    bankTransactionIds: [candidate.id],
                    details: {
                        deposits: [deposit],
                        transactions: [candidate]
                    },
                    matchNote: deposit.date !== candidate.date ? `Matched to ${candidate.date}` : undefined
                });
            } else {
                // No match found
                rows.push({
                    date: deposit.date,
                    displayDate: deposit.date,
                    dentrixTotal: deposit.total,
                    bankTotal: 0,
                    difference: 0 - deposit.total,
                    matches: false,
                    depositRecordIds: [deposit.id],
                    bankTransactionIds: [],
                    details: {
                        deposits: [deposit],
                        transactions: []
                    }
                });
            }
        });

        // B. Find "Orphan" transactions for THIS month
        // These are transactions in the current month that presumably didn't match any deposit
        const orphans = poolTransactions.filter(t => {
            if (matchedTransactionIds.has(t.id)) return false;

            const dt = new Date(t.date);
            return dt.getFullYear() === targetYear && dt.getMonth() === targetMonth;
        });

        orphans.forEach(t => {
            // Check if this date already exists in rows (partially matched?)
            // Actually, for orphans, we just add them as separate rows if they don't align with a deposit
            // BUT, if we have multiple orphans on the same day, we might want to group them?
            // For now, simpler to verify ONE valid connection.
            // Let's group orphans by DATE to keep the view clean.

            // Note: complex because we might have a row for this date already from a Deposit.
            // If we do, we should technically append to it? 
            // Current Logic: Deposits drive the rows. Orphans are mismatches.

            // Check if we already have a row for this date that is unmatched? 
            // Or just add a new row. Adding a new row is clearer for "Extra Bank Deposit".

            rows.push({
                date: t.date,
                displayDate: t.date,
                dentrixTotal: 0,
                bankTotal: t.amount,
                difference: t.amount,
                matches: false,
                depositRecordIds: [],
                bankTransactionIds: [t.id],
                details: {
                    deposits: [],
                    transactions: [t]
                },
                isOrphan: true
            });
        });

        // 4. Grouping? 
        // If we have multiple rows for the same date (e.g. Deposit matched + Orphan on same day),
        // The UI handles them as separate rows in the array.
        // We probably want to sort them by date.

        rows.sort((a, b) => b.date.localeCompare(a.date));

        return rows;
    }, [deposits, transactions, viewScope, selectedDate]);

    const toggleRow = (date: string) => {
        // Use composite key if possible or just handle uniqueness
        // Since we might have duplicates dates, using date as ID is risky for expansion?
        // Let's just allow it for now, usually one row per day.
        setExpandedRow(expandedRow === date ? null : date);
    };

    // --- Year View Render ---
    if (viewScope === 'year') {
        return (
            <div className="space-y-6">
                <CalendarStatus
                    datesWithSheets={datesWithSheets}
                    viewScope={viewScope}
                    selectedDate={selectedDate}
                    onSelectMonth={onSelectMonth}
                    onBackToYear={onBackToYear}
                />
                <div className="bg-white dark:bg-gray-800 shadow rounded-lg overflow-hidden transition-colors duration-200">
                    <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-700">
                        <h2 className="text-lg font-bold text-gray-800 dark:text-white">Financial Summary</h2>
                    </div>
                    <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
                        <thead className="bg-gray-50 dark:bg-gray-700">
                            <tr>
                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase">Month</th>
                                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-300 uppercase">Dentrix Total</th>
                                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-300 uppercase">Bank Total</th>
                                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-300 uppercase">Difference</th>
                                <th className="px-6 py-3 text-center text-xs font-medium text-gray-500 dark:text-gray-300 uppercase">Status</th>
                                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-300 uppercase">Action</th>
                            </tr>
                        </thead>
                        <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
                            {yearSummary.map(row => (
                                <tr key={row.monthName} className="hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors">
                                    <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900 dark:text-white">{row.monthName}</td>
                                    <td className="px-6 py-4 whitespace-nowrap text-sm text-right text-gray-600 dark:text-gray-300">
                                        {row.totalDentrix > 0 ? `$${row.totalDentrix.toLocaleString(undefined, { minimumFractionDigits: 2 })}` : '-'}
                                    </td>
                                    <td className="px-6 py-4 whitespace-nowrap text-sm text-right text-gray-600 dark:text-gray-300">
                                        {row.totalBank > 0 ? `$${row.totalBank.toLocaleString(undefined, { minimumFractionDigits: 2 })}` : '-'}
                                    </td>
                                    <td className={`px-6 py-4 whitespace-nowrap text-sm text-right font-bold 
                                         ${row.diff === 0 ? 'text-gray-400 dark:text-gray-500' : row.diff > 0 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>
                                        {Math.abs(row.diff) < 0.01 ? '-' : `${row.diff > 0 ? '+' : ''}${row.diff.toFixed(2)}`}
                                    </td>
                                    <td className="px-6 py-4 whitespace-nowrap text-center">
                                        <span className={`px-2 py-1 text-xs font-semibold rounded-full 
                                             ${row.status === 'green' ? 'bg-green-100 dark:bg-green-900 text-green-800 dark:text-green-200' : ''}
                                             ${row.status === 'orange' ? 'bg-orange-100 dark:bg-orange-900 text-orange-800 dark:text-orange-200' : ''}
                                             ${row.status === 'red' ? 'bg-gray-100 dark:bg-gray-700 text-gray-800 dark:text-gray-300' : ''}
                                         `}>
                                            {row.status === 'green' ? 'Success' : row.status === 'orange' ? 'Action Needed' : 'Not Started'}
                                        </span>
                                    </td>
                                    <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                                        <button
                                            onClick={() => onSelectMonth(row.date)}
                                            className="text-blue-600 dark:text-blue-400 hover:text-blue-900 dark:hover:text-blue-300"
                                        >
                                            View Details
                                        </button>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>
        );
    }

    // --- Month View Render ---
    return (
        <div className="space-y-6">
            <CalendarStatus
                datesWithSheets={datesWithSheets}
                viewScope={viewScope}
                selectedDate={selectedDate}
                onSelectMonth={onSelectMonth}
                onBackToYear={onBackToYear}
            />

            <div className="flex justify-between items-center bg-white dark:bg-gray-800 p-4 rounded-lg shadow-sm transition-colors duration-200">
                <div>
                    <h2 className="text-xl font-bold text-gray-800 dark:text-white">Reconciliation Dashboard</h2>
                    <p className="text-sm text-gray-500 dark:text-gray-400">Matching daily Dentrix totals with Bank Deposits.</p>
                </div>
                <div className="flex gap-4 text-sm">
                    <div className="flex items-center dark:text-gray-300"><span className="w-3 h-3 bg-green-100 dark:bg-green-900 border border-green-500 dark:border-green-600 rounded-full mr-2"></span> Matched</div>
                    <div className="flex items-center dark:text-gray-300"><span className="w-3 h-3 bg-red-100 dark:bg-red-900 border border-red-500 dark:border-red-600 rounded-full mr-2"></span> Discrepancy</div>
                </div>
            </div>

            <div className="bg-white dark:bg-gray-800 shadow overflow-hidden rounded-lg transition-colors duration-200">
                <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
                    <thead className="bg-gray-50 dark:bg-gray-700">
                        <tr>
                            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Date</th>
                            <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Dentrix Total</th>
                            <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Bank Total</th>
                            <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Difference</th>
                            <th className="px-6 py-3 text-center text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Status</th>
                            <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Action</th>
                        </tr>
                    </thead>
                    <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
                        {reconciliationData.length === 0 ? (
                            <tr>
                                <td colSpan={6} className="px-6 py-12 text-center text-gray-500 dark:text-gray-400">
                                    No transactions found for {selectedDate.toLocaleString('default', { month: 'long' })}.
                                    <br />
                                    <button onClick={onBackToYear} className="mt-2 text-blue-500 dark:text-blue-400 underline">Back to Year View</button>
                                </td>
                            </tr>
                        ) : (
                            reconciliationData.map((row, idx) => (
                                <React.Fragment key={`${row.date}-${idx}`}>
                                    <tr className={`hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors ${row.matches ? '' : 'bg-red-50/30 dark:bg-red-900/10'}`}>
                                        <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900 dark:text-white">
                                            {row.displayDate}
                                            {row.isOrphan && <span className="ml-2 text-xs text-orange-500">Unmatched Bank</span>}
                                            {row.isUnknown && <span className="ml-2 text-xs text-purple-600 font-bold bg-purple-100 px-1 rounded" title="Unknown Payment Type">?</span>}
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap text-sm text-right text-gray-600 dark:text-gray-300">
                                            {row.dentrixTotal > 0 ? `$${row.dentrixTotal.toFixed(2)}` : '-'}
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap text-sm text-right text-gray-600 dark:text-gray-300">
                                            <div>${row.bankTotal.toFixed(2)}</div>
                                            {row.matchNote && (
                                                <div className="text-[10px] text-gray-400 dark:text-gray-500 font-normal">
                                                    ({row.matchNote})
                                                </div>
                                            )}
                                        </td>
                                        <td className={`px-6 py-4 whitespace-nowrap text-sm text-right font-bold ${row.difference === 0 ? 'text-gray-400 dark:text-gray-500' : row.difference > 0 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>
                                            {Math.abs(row.difference) < 0.01 ? '-' : `${row.difference > 0 ? '+' : ''}${row.difference.toFixed(2)}`}
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap text-center">
                                            {row.matches ? (
                                                <span className="px-2 inline-flex text-xs leading-5 font-semibold rounded-full bg-green-100 dark:bg-green-900 text-green-800 dark:text-green-200">
                                                    Matched
                                                </span>
                                            ) : (
                                                <span className="px-2 inline-flex text-xs leading-5 font-semibold rounded-full bg-red-100 dark:bg-red-900 text-red-800 dark:text-red-200">
                                                    Mismatch
                                                </span>
                                            )}
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                                            <button
                                                onClick={() => toggleRow(`${row.date}-${idx}`)}
                                                className="text-blue-600 dark:text-blue-400 hover:text-blue-900 dark:hover:text-blue-300 focus:outline-none"
                                            >
                                                {expandedRow === `${row.date}-${idx}` ? 'Hide Details' : 'View Details'}
                                            </button>
                                        </td>
                                    </tr>
                                    {expandedRow === `${row.date}-${idx}` && (
                                        <tr className="bg-gray-50 dark:bg-gray-900">
                                            <td colSpan={6} className="px-6 py-4">
                                                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                                    {/* Dentrix Details */}
                                                    <div className="bg-white dark:bg-gray-800 border dark:border-gray-700 rounded p-4">
                                                        <h4 className="font-bold text-gray-700 dark:text-gray-200 mb-2 border-b dark:border-gray-700 pb-1">Dentrix Breakdown</h4>
                                                        {row.details.deposits.length === 0 ? (
                                                            <p className="text-sm text-gray-400 italic">No Dentrix records for this date.</p>
                                                        ) : (
                                                            <div className="space-y-3">
                                                                {row.details.deposits.map(d => (
                                                                    <div key={d.id} className="text-sm">
                                                                        <div className="flex justify-between font-medium text-gray-800 dark:text-gray-200 bg-gray-100 dark:bg-gray-700 p-1 rounded">
                                                                            <span>Slip Total:</span>
                                                                            <span>${d.total.toFixed(2)}</span>
                                                                        </div>
                                                                        <div className="pl-2 mt-1 space-y-1 text-gray-600 dark:text-gray-400 text-xs">
                                                                            <div className="flex justify-between"><span>Cash Payment:</span> <span>${d.breakdown.cash.toFixed(2)}</span></div>
                                                                            <div className="flex justify-between"><span>Check Payment:</span> <span>${d.breakdown.checks.toFixed(2)}</span></div>
                                                                            <div className="flex justify-between"><span>Dental Ins Check:</span> <span>${d.breakdown.insuranceChecks.toFixed(2)}</span></div>
                                                                            <div className="flex justify-between"><span>Credit Card Payment:</span> <span>${d.breakdown.creditCards.toFixed(2)}</span></div>
                                                                            {d.breakdown.insuranceCreditCards > 0 && (
                                                                                <div className="flex justify-between"><span>Dental Ins Credit Card:</span> <span>${d.breakdown.insuranceCreditCards.toFixed(2)}</span></div>
                                                                            )}
                                                                            <div className="flex justify-between"><span>CareCredit:</span> <span>${d.breakdown.careCredit.toFixed(2)}</span></div>
                                                                        </div>
                                                                        {d.sourceImage && (
                                                                            <div className="mt-2">
                                                                                <p className="text-xs text-gray-400 mb-1">Processed Image (Click to Enlarge):</p>
                                                                                <img
                                                                                    src={d.sourceImage}
                                                                                    className="h-20 object-contain border dark:border-gray-600 rounded bg-black cursor-pointer hover:opacity-80 transition-opacity"
                                                                                    alt="Slip"
                                                                                    onClick={() => setEnlargedImage(d.sourceImage!)}
                                                                                />
                                                                            </div>
                                                                        )}
                                                                        {onDeleteDeposit && (
                                                                            <button
                                                                                onClick={() => onDeleteDeposit(d.id)}
                                                                                className="mt-3 text-xs text-red-500 hover:text-red-700 underline"
                                                                            >
                                                                                Delete Day Sheet
                                                                            </button>
                                                                        )}
                                                                    </div>
                                                                ))}
                                                            </div>
                                                        )}
                                                    </div>

                                                    {/* Bank Details */}
                                                    <div className="bg-white dark:bg-gray-800 border dark:border-gray-700 rounded p-4">
                                                        <h4 className="font-bold text-gray-700 dark:text-gray-200 mb-2 border-b dark:border-gray-700 pb-1">Bank Transactions</h4>
                                                        {row.details.transactions.length === 0 ? (
                                                            <p className="text-sm text-gray-400 italic">No bank deposits for this date.</p>
                                                        ) : (
                                                            <ul className="space-y-2">
                                                                {row.details.transactions.map(t => (
                                                                    <li key={t.id} className="flex justify-between items-center text-sm border-b border-dashed border-gray-200 dark:border-gray-700 pb-1 last:border-0">
                                                                        <span className="text-gray-600 dark:text-gray-300 truncate max-w-[200px]" title={t.description}>{t.description}</span>
                                                                        <span className="font-medium text-green-600 dark:text-green-400">+${t.amount.toFixed(2)}</span>
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
                            ))
                        )}
                    </tbody>
                </table>
            </div>

            {/* Image Modal */}
            {enlargedImage && (
                <div
                    className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/90 backdrop-blur-sm"
                    onClick={() => setEnlargedImage(null)}
                >
                    <div className="relative w-full h-full max-w-[95vw] max-h-[95vh] flex items-center justify-center overflow-hidden">
                        <button
                            onClick={() => setEnlargedImage(null)}
                            className="absolute top-4 right-4 p-3 bg-black/50 hover:bg-black/80 text-white rounded-full transition-colors z-20 backdrop-blur-md"
                        >
                            <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                            </svg>
                        </button>
                        <img
                            src={enlargedImage}
                            alt="Full Size Slip"
                            className="max-w-full max-h-full object-contain rounded shadow-2xl"
                            onClick={(e) => e.stopPropagation()}
                        />
                    </div>
                </div>
            )}
        </div>
    );
};

export default ReconciliationView;
