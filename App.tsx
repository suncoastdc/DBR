import React, { useState, useEffect } from 'react';
import { AppView, DepositRecord, BankTransaction } from './types';
import DepositProcessor from './components/DepositProcessor';
import BankImport from './components/BankImport';
import ReconciliationView from './components/ReconciliationView';
import { checkForUpdate, UpdateCheckResult } from './services/updateService';

const App: React.FC = () => {
  const [currentView, setCurrentView] = useState<AppView>(AppView.RECONCILE);
  const [deposits, setDeposits] = useState<DepositRecord[]>([]);
  const [bankTransactions, setBankTransactions] = useState<BankTransaction[]>([]);
  const [updateInfo, setUpdateInfo] = useState<UpdateCheckResult | null>(null);

  // Load from local storage on mount
  useEffect(() => {
    const savedDeposits = localStorage.getItem('dbr_deposits');
    const savedTx = localStorage.getItem('dbr_transactions');
    if (savedDeposits) setDeposits(JSON.parse(savedDeposits));
    if (savedTx) setBankTransactions(JSON.parse(savedTx));
  }, []);

  // Check for app updates on load
  useEffect(() => {
    checkForUpdate().then(setUpdateInfo);
  }, []);

  // Save to local storage on change
  useEffect(() => {
    localStorage.setItem('dbr_deposits', JSON.stringify(deposits));
  }, [deposits]);

  useEffect(() => {
    localStorage.setItem('dbr_transactions', JSON.stringify(bankTransactions));
  }, [bankTransactions]);

  const handleSaveDeposit = (record: DepositRecord) => {
    setDeposits(prev => [...prev, record]);
    setCurrentView(AppView.RECONCILE);
  };

  const handleImportBank = (txs: BankTransaction[]) => {
    // Append new transactions, avoiding duplicates by ID if possible, 
    // but here we just append since IDs are timestamp based.
    // In a real app, we'd dedup based on hash of content.
    setBankTransactions(prev => [...prev, ...txs]);
    setCurrentView(AppView.RECONCILE);
  };

  const handleResetData = () => {
      if(window.confirm("Are you sure you want to clear all stored data? This cannot be undone.")) {
          setDeposits([]);
          setBankTransactions([]);
          localStorage.removeItem('dbr_deposits');
          localStorage.removeItem('dbr_transactions');
      }
  }

  const renderContent = () => {
    switch (currentView) {
      case AppView.IMPORT_SLIPS:
        return <DepositProcessor onSave={handleSaveDeposit} />;
      case AppView.IMPORT_BANK:
        return <BankImport onImport={handleImportBank} />;
      case AppView.RECONCILE:
      default:
        return <ReconciliationView deposits={deposits} transactions={bankTransactions} />;
    }
  };

  return (
    <div className="min-h-screen bg-gray-100 flex flex-col font-sans">
      {/* Header */}
      <header className="bg-blue-800 text-white shadow-md sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center space-x-3">
             <i className="fas fa-file-invoice-dollar text-2xl"></i>
             <h1 className="text-xl font-bold tracking-wide">DBR <span className="font-light opacity-80 text-sm hidden sm:inline">| Dentrix Bank Reconciler</span></h1>
          </div>
          
          <nav className="flex space-x-2 md:space-x-4">
            <button 
              onClick={() => setCurrentView(AppView.RECONCILE)}
              className={`px-3 py-2 rounded-md text-sm font-medium transition-colors ${currentView === AppView.RECONCILE ? 'bg-blue-900 text-white' : 'text-blue-100 hover:bg-blue-700'}`}
            >
              <i className="fas fa-columns sm:mr-2"></i><span className="hidden sm:inline">Reconcile</span>
            </button>
            <button 
              onClick={() => setCurrentView(AppView.IMPORT_SLIPS)}
              className={`px-3 py-2 rounded-md text-sm font-medium transition-colors ${currentView === AppView.IMPORT_SLIPS ? 'bg-blue-900 text-white' : 'text-blue-100 hover:bg-blue-700'}`}
            >
              <i className="fas fa-file-medical sm:mr-2"></i><span className="hidden sm:inline">Add Slip</span>
            </button>
            <button 
              onClick={() => setCurrentView(AppView.IMPORT_BANK)}
              className={`px-3 py-2 rounded-md text-sm font-medium transition-colors ${currentView === AppView.IMPORT_BANK ? 'bg-blue-900 text-white' : 'text-blue-100 hover:bg-blue-700'}`}
            >
              <i className="fas fa-university sm:mr-2"></i><span className="hidden sm:inline">Import Bank</span>
            </button>
          </nav>

          {updateInfo?.updateAvailable && (
            <a
              href={updateInfo.downloadUrl}
              target="_blank"
              rel="noreferrer"
              className="ml-4 px-3 py-2 bg-yellow-400 text-blue-900 rounded-md text-xs font-semibold shadow hover:bg-yellow-300"
              title={`Current: ${updateInfo.current} • Latest: ${updateInfo.latest}`}
            >
              Update available
            </a>
          )}
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {renderContent()}
      </main>

      {/* Footer */}
      <footer className="bg-white border-t mt-auto">
        <div className="max-w-7xl mx-auto px-4 py-4 sm:px-6 lg:px-8 flex justify-between items-center">
            <p className="text-sm text-gray-500">
                <i className="fas fa-shield-alt text-green-600 mr-1"></i>
                Local Processing Only. No PHI stored in cloud.
            </p>
            <button onClick={handleResetData} className="text-xs text-red-400 hover:text-red-600 underline">
                Reset All Data
            </button>
        </div>
      </footer>
    </div>
  );
};

export default App;
