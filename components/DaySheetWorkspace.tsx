import React from 'react';
import DepositProcessor from './DepositProcessor';
import BulkPdfImport from './BulkPdfImport';
import { DepositRecord } from '../types';

interface DaySheetWorkspaceProps {
  onSave: (record: DepositRecord) => void;
  onImportedDate: (date: string) => void;
}

const DaySheetWorkspace: React.FC<DaySheetWorkspaceProps> = ({ onSave, onImportedDate }) => {
  return (
    <div className="space-y-6">
      <div className="bg-white dark:bg-gray-800 shadow rounded-lg p-4 sm:p-6 transition-colors duration-200">
        <div className="mb-4">
          <h2 className="text-xl sm:text-2xl font-bold text-gray-800 dark:text-white">Day Sheet Intake</h2>
          <p className="text-sm text-gray-600 dark:text-gray-400">Capture or upload a single day sheet for AI extraction.</p>
        </div>
        <DepositProcessor onSave={onSave} />
      </div>

      <div>
        <BulkPdfImport onSave={onSave} onImportedDate={onImportedDate} />
      </div>
    </div>
  );
};

export default DaySheetWorkspace;
