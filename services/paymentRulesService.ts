import { BankTransaction, DepositBreakdown } from '../types';

const PAYMENT_RULES_KEY = 'dbr_payment_rules';

export type PaymentTypeKey = keyof DepositBreakdown;

export interface PaymentRule {
  pattern: string; // lowercase keyword to look for inside the bank description
  type: PaymentTypeKey;
  source?: 'manual' | 'learned';
  createdAt: string;
}

export interface RuleSuggestion {
  pattern: string;
  suggestedType?: PaymentTypeKey;
  count: number;
}

const normalizeText = (value: string) => value.replace(/\s+/g, ' ').trim().toLowerCase();

export function loadPaymentRules(): PaymentRule[] {
  try {
    const raw = localStorage.getItem(PAYMENT_RULES_KEY);
    if (!raw) return [];
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

export function savePaymentRules(rules: PaymentRule[]) {
  localStorage.setItem(PAYMENT_RULES_KEY, JSON.stringify(rules));
}

export function inferPaymentType(description: string, rules: PaymentRule[] = loadPaymentRules()): PaymentTypeKey | undefined {
  const normalized = normalizeText(description);
  const match = rules.find((rule) => normalized.includes(rule.pattern));
  return match?.type;
}

export function createPatternFromDescription(description: string): string | null {
  const normalizedDesc = normalizeText(description);
  const pattern = extractPattern(normalizedDesc);
  if (pattern) return pattern;
  return normalizedDesc ? normalizedDesc.slice(0, 32) : null;
}

export function upsertPaymentRule(pattern: string, type: PaymentTypeKey, source: PaymentRule['source'] = 'manual'): PaymentRule[] {
  const normalizedPattern = normalizeText(pattern);
  const rules = loadPaymentRules();
  const existingIndex = rules.findIndex((r) => r.pattern === normalizedPattern);
  const nextRule: PaymentRule = {
    pattern: normalizedPattern,
    type,
    source,
    createdAt: existingIndex !== -1 ? rules[existingIndex].createdAt : new Date().toISOString(),
  };

  if (existingIndex !== -1) {
    rules[existingIndex] = { ...rules[existingIndex], ...nextRule };
  } else {
    rules.push(nextRule);
  }

  savePaymentRules(rules);
  return rules;
}

export function suggestRulesFromTransactions(transactions: BankTransaction[], rules: PaymentRule[]): RuleSuggestion[] {
  const suggestions: Record<string, RuleSuggestion> = {};
  const normalizedRules = rules.map((r) => r.pattern);

  transactions.forEach((tx) => {
    const normalizedDesc = normalizeText(tx.description);
    if (normalizedRules.some((pattern) => normalizedDesc.includes(pattern))) return;

    const pattern = extractPattern(normalizedDesc);
    if (!pattern) return;

    const guess = guessTypeFromText(normalizedDesc);
    const key = pattern;
    const existing = suggestions[key];
    if (existing) {
      existing.count += 1;
      if (!existing.suggestedType && guess) existing.suggestedType = guess;
    } else {
      suggestions[key] = { pattern: key, suggestedType: guess, count: 1 };
    }
  });

  return Object.values(suggestions)
    .sort((a, b) => b.count - a.count)
    .slice(0, 8);
}

function extractPattern(normalizedDesc: string): string | null {
  // Remove numbers/punctuation to find a stable keyword chunk.
  const cleaned = normalizedDesc.replace(/[^a-z\s]/g, ' ').replace(/\s+/g, ' ').trim();
  const tokens = cleaned.split(' ').filter((t) => t.length > 2);
  if (tokens.length === 0) return null;
  // Take the first one or two tokens to create a reusable pattern.
  return tokens.slice(0, 2).join(' ');
}

function guessTypeFromText(normalizedDesc: string): PaymentTypeKey | undefined {
  if (includesAny(normalizedDesc, ['carecredit', 'care credit'])) return 'careCredit';
  if (includesAny(normalizedDesc, ['cherry'])) return 'cherry';
  if (includesAny(normalizedDesc, ['visa', 'mastercard', 'mc', 'amex', 'discover', 'square', 'stripe', 'cardpointe']))
    return 'creditCards';
  if (includesAny(normalizedDesc, ['ach', 'eft', 'transfer'])) return 'eft';
  if (includesAny(normalizedDesc, ['insurance', 'ins ', 'bcbs', 'dental', 'aetna', 'delta'])) return 'insuranceChecks';
  if (includesAny(normalizedDesc, ['check', 'cheque', 'chk'])) return 'checks';
  if (includesAny(normalizedDesc, ['cash'])) return 'cash';
  return undefined;
}

function includesAny(text: string, needles: string[]) {
  return needles.some((n) => text.includes(n));
}
