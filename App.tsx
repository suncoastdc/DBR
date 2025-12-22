import React, { useState, useEffect } from 'react';
import { AppView, DepositRecord, BankTransaction } from './types';
import BankImport from './components/BankImport';
import ReconciliationView from './components/ReconciliationView';
import SettingsModal from './components/SettingsModal';
import { getImportedDates, loadImportLog } from './services/importLogService';
import CalendarStatus from './components/CalendarStatus';
import DaySheetWorkspace from './components/DaySheetWorkspace';
import { useTheme } from './contexts/ThemeContext';

const App: React.FC = () => {
  const appVersion = import.meta.env.APP_VERSION || 'dev';
  const { theme, toggleTheme } = useTheme();
  const [currentView, setCurrentView] = useState<AppView>(AppView.RECONCILE);
  const [deposits, setDeposits] = useState<DepositRecord[]>([]);
  const [bankTransactions, setBankTransactions] = useState<BankTransaction[]>([]);
  const [updateStatus, setUpdateStatus] = useState<string>('');
  const [updateReady, setUpdateReady] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [importedDates, setImportedDates] = useState<Set<string>>(new Set());

  // New State for Workflow
  const [viewScope, setViewScope] = useState<'year' | 'month'>('year');
  const [selectedDate, setSelectedDate] = useState<Date>(new Date()); // Represents the focal point (Month/Year)

  // Load from local storage on mount
  useEffect(() => {
    const savedDeposits = localStorage.getItem('dbr_deposits');
    const savedTx = localStorage.getItem('dbr_transactions');

    if (savedDeposits) {
      try {
        setDeposits(JSON.parse(savedDeposits));
      } catch (e) {
        console.error('Failed to parse deposits', e);
      }
    }

    if (savedTx) {
      try {
        setBankTransactions(JSON.parse(savedTx));
      } catch (e) {
        console.error('Failed to parse transactions', e);
      }
    }

    setImportedDates(getImportedDates(loadImportLog()));
  }, []);

  // Update Listeners
  useEffect(() => {
    // @ts-ignore
    if (!window.electronAPI?.updater) return;

    // @ts-ignore
    window.electronAPI.updater.onUpdateAvailable((info) => {
      setUpdateStatus(`Update available: ${info.version}. Downloading...`);
    });

    // @ts-ignore
    window.electronAPI.updater.onUpdateChecking(() => {
      setUpdateStatus('Checking for updates...');
      setUpdateReady(false);
    });

    // @ts-ignore
    window.electronAPI.updater.onUpdateProgress((progress) => {
      setUpdateStatus(`Downloading: ${progress.percent.toFixed(0)}%`);
    });

    // @ts-ignore
    window.electronAPI.updater.onUpdateDownloaded((info) => {
      setUpdateStatus(`Update ready: ${info.version}`);
      setUpdateReady(true);
      if (window.confirm(`New version ${info.version} is ready to install.\n\nRestart now?`)) {
        // @ts-ignore
        window.electronAPI.updater.quitAndInstall();
      }
    });

    // @ts-ignore
    window.electronAPI.updater.onUpdateError((err) => {
      console.error('Update error:', err);
      setUpdateStatus(`Update error: ${err}`);
      setUpdateReady(false);
    });

    // @ts-ignore
    window.electronAPI.updater.onUpdateNotAvailable(() => {
      setUpdateStatus('');
      setUpdateReady(false);
    });
  }, []);

  // Save to local storage on change
  useEffect(() => {
    localStorage.setItem('dbr_deposits', JSON.stringify(deposits));
  }, [deposits]);

  useEffect(() => {
    localStorage.setItem('dbr_transactions', JSON.stringify(bankTransactions));
  }, [bankTransactions]);

  const normalizeDescription = (value: string) => value.replace(/\s+/g, ' ').trim().toLowerCase();
  const buildSignature = (tx: Pick<BankTransaction, 'date' | 'description' | 'amount'>) =>
    `${tx.date}|${normalizeDescription(tx.description)}|${tx.amount.toFixed(2)}`;

  const handleSaveDeposit = (record: DepositRecord) => {
    setDeposits(prev => [...prev, record]);
    setCurrentView(AppView.RECONCILE);
    // Auto-switch to the month of the imported data to keep flow
    const recordDate = new Date(record.date);
    setSelectedDate(recordDate);
    setViewScope('month');
  };

  const handleImportBank = (txs: BankTransaction[]) => {
    setBankTransactions(prev => {
      const seen = new Set(prev.map(tx => buildSignature(tx)));
      const merged = [...prev];

      txs.forEach(tx => {
        const signature = buildSignature(tx);
        if (seen.has(signature)) return;
        seen.add(signature);
        merged.push(tx);
      });

      return merged.sort((a, b) => a.date.localeCompare(b.date));
    });
    setCurrentView(AppView.RECONCILE);
    // Auto-switch to the month of the first imported transaction
    if (txs.length > 0) {
      const firstDate = new Date(txs[0].date);
      setSelectedDate(firstDate);
      setViewScope('month');
    }
  };

  const handleImportedDate = (date: string) => {
    setImportedDates(prev => new Set([...Array.from(prev), date]));
  };

  const handleResetData = () => {
    if (window.confirm("Are you sure you want to clear all stored data? This cannot be undone.")) {
      setDeposits([]);
      setBankTransactions([]);
      localStorage.removeItem('dbr_deposits');
      localStorage.removeItem('dbr_transactions');
      setImportedDates(new Set());
    }
  };

  const datesWithSheets = new Set([
    ...Array.from(importedDates),
    ...deposits.map(d => d.date),
  ]);

  // Navigation Handlers
  const handleSelectMonth = (date: Date) => {
    setSelectedDate(date);
    setViewScope('month');
  };

  const handleBackToYear = () => {
    setViewScope('year');
  };

  const handleDeleteDeposit = (id: string) => {
    if (window.confirm("Are you sure you want to delete this Day Sheet? This action cannot be undone.")) {
      setDeposits(prev => prev.filter(d => d.id !== id));
      // Optionally update importedDates if no more deposits for that date exist,
      // but keeping it simple for now as it just tracks "ever imported".
    }
  };

  const renderContent = () => {
    switch (currentView) {
      case AppView.DASHBOARD:
      case AppView.RECONCILE:
        return (
          <ReconciliationView
            deposits={deposits}
            transactions={bankTransactions}
            viewScope={viewScope}
            selectedDate={selectedDate}
            onSelectMonth={handleSelectMonth}
            onBackToYear={handleBackToYear}
            datesWithSheets={datesWithSheets}
            onDeleteDeposit={handleDeleteDeposit}
          />
        );
      case AppView.IMPORT_SLIPS:
        return <DaySheetWorkspace onSave={handleSaveDeposit} onImportedDate={handleImportedDate} />;
      case AppView.IMPORT_BANK:
        return <BankImport onImport={handleImportBank} existingTransactions={bankTransactions} />;
      default:
        return (
          <ReconciliationView
            deposits={deposits}
            transactions={bankTransactions}
            viewScope={viewScope}
            selectedDate={selectedDate}
            onSelectMonth={handleSelectMonth}
            onBackToYear={handleBackToYear}
            datesWithSheets={datesWithSheets}
            onDeleteDeposit={handleDeleteDeposit}
          />
        );
    }
  };

  return (
    <div className="min-h-screen bg-gray-100 dark:bg-gray-900 flex flex-col font-sans transition-colors duration-200">
      {/* Header */}
      <header className="bg-blue-800 dark:bg-blue-900 text-white shadow-md sticky top-0 z-50 transition-colors duration-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <i className="fas fa-file-invoice-dollar text-2xl"></i>
            <h1 className="text-xl font-bold tracking-wide">DBR <span className="font-light opacity-80 text-sm hidden sm:inline">| Dentrix Bank Reconciler</span></h1>
          </div>

          <nav className="flex space-x-2 md:space-x-4">
            <button
              onClick={() => setCurrentView(AppView.RECONCILE)}
              className={`px-3 py-2 rounded-md text-sm font-medium transition-colors ${currentView === AppView.RECONCILE ? 'bg-blue-900 dark:bg-blue-800 text-white' : 'text-blue-100 hover:bg-blue-700 dark:hover:bg-blue-800'}`}
            >
              <i className="fas fa-columns sm:mr-2"></i><span className="hidden sm:inline">Reconcile</span>
            </button>
            <button
              onClick={() => setCurrentView(AppView.IMPORT_SLIPS)}
              className={`px-3 py-2 rounded-md text-sm font-medium transition-colors ${currentView === AppView.IMPORT_SLIPS ? 'bg-blue-900 dark:bg-blue-800 text-white' : 'text-blue-100 hover:bg-blue-700 dark:hover:bg-blue-800'}`}
            >
              <i className="fas fa-file-medical sm:mr-2"></i><span className="hidden sm:inline">Day Sheets</span>
            </button>
            <button
              onClick={() => setCurrentView(AppView.IMPORT_BANK)}
              className={`px-3 py-2 rounded-md text-sm font-medium transition-colors ${currentView === AppView.IMPORT_BANK ? 'bg-blue-900 dark:bg-blue-800 text-white' : 'text-blue-100 hover:bg-blue-700 dark:hover:bg-blue-800'}`}
            >
              <i className="fas fa-university sm:mr-2"></i><span className="hidden sm:inline">Import Bank</span>
            </button>
          </nav>

          <div className="flex items-center gap-3">
            {updateStatus && (
              <button
                onClick={() => updateReady && window.confirm("Restart now?") && window.electronAPI!.updater!.quitAndInstall()}
                className={`px-3 py-2 rounded-md text-xs font-semibold shadow transition-colors ${updateReady
                    ? 'bg-green-500 hover:bg-green-400 text-white animate-pulse'
                    : 'bg-yellow-400 text-blue-900'
                  }`}
                title={updateStatus}
              >
                {updateStatus}
              </button>
            )}
            <button
              onClick={toggleTheme}
              className="p-2 rounded-full text-white hover:bg-blue-700 dark:hover:bg-blue-800 transition-colors"
              title={theme === 'dark' ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
            >
              <i
                className="fas fa-adjust text-lg transition-transform duration-300"
                style={{ transform: theme === 'dark' ? 'rotate(180deg)' : 'rotate(0deg)' }}
              ></i>
            </button>
            <button
              onClick={() => setSettingsOpen(true)}
              className="px-3 py-2 bg-white/10 hover:bg-white/20 rounded-md text-xs font-semibold flex items-center gap-2 transition-colors"
            >
              <i className="fas fa-cog"></i>
              <span className="hidden sm:inline">Settings</span>
            </button>
            <span className="text-[11px] text-blue-100 bg-blue-900/50 px-2 py-1 rounded">v{appVersion}</span>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {renderContent()}
      </main>

      {/* Footer */}
      <footer className="bg-white dark:bg-gray-800 border-t dark:border-gray-700 mt-auto transition-colors duration-200">
        <div className="max-w-7xl mx-auto px-4 py-4 sm:px-6 lg:px-8 flex justify-between items-center">
          <p className="text-sm text-gray-500 dark:text-gray-400">
            <i className="fas fa-shield-alt text-green-600 dark:text-green-500 mr-1"></i>
            Local Processing Only. No PHI stored in cloud.
          </p>
          <button onClick={handleResetData} className="text-xs text-red-400 hover:text-red-600 dark:hover:text-red-300 underline">
            Reset All Data
          </button>
        </div>
      </footer>

      <SettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </div>
  );
};

export default App;
