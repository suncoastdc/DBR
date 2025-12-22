export interface DepositBreakdown {
  cash: number;
  checks: number;
  checkList?: number[]; // Array of individual check amounts
  insuranceChecks: number;
  creditCards: number; // Visa/MC/Amex/Discover combined
  creditCardBreakdown?: {
    visa: number;
    masterCard: number;
    amex: number;
    discover: number;
  };
  insuranceCreditCards: number; // Dental Insurance Credit Card payments
  careCredit: number;
  cherry: number;
  eft: number;
  other: number;
}

export interface DepositRecord {
  id: string;
  date: string; // YYYY-MM-DD
  total: number;
  breakdown: DepositBreakdown;
  sourceImage?: string; // Small base64 thumbnail for reference
  status: 'verified' | 'pending';
  notes?: string;
}

export interface BankTransaction {
  id: string;
  date: string; // YYYY-MM-DD
  description: string;
  amount: number; // Positive for deposit
  paymentType?: keyof DepositBreakdown; // Learned mapping from bank description
  category?: string;
}

export interface ReconciliationStatus {
  date: string;
  dentrixTotal: number;
  bankTotal: number;
  difference: number;
  matches: boolean;
  depositRecordIds: string[];
  bankTransactionIds: string[];
}

export enum AppView {
  DASHBOARD = 'DASHBOARD',
  IMPORT_SLIPS = 'IMPORT_SLIPS',
  IMPORT_BANK = 'IMPORT_BANK',
  RECONCILE = 'RECONCILE'
}

export type ModelProvider = 'gemini' | 'openai';

export interface ElectronAPI {
  captureScreen: () => Promise<string>;
  listPdfs: (folderPath: string) => Promise<{ name: string; path: string; mtimeMs: number }[]>;
  readPdfBase64: (filePath: string) => Promise<string>;
  selectFolder: () => Promise<string | null>;
}


