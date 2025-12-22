import { GoogleGenAI, Type, Schema } from "@google/genai";
import { DepositRecord } from "../types";
import { getApiKey, getProvider } from "./settingsService";

const BANK_STATEMENT_INSTRUCTION = `
You are a data extraction assistant.
Your task is to extract line-item transactions from an image of a bank statement.

RULES:
1. Extract ALL transactions (deposits, credits, withdrawals, debits, fees).
2. **Date**: YYYY-MM-DD format.
3. **Description**: Complete description text.
4. **Amount**: 
   - Positive number for DEPOSITS / CREDITS.
   - Negative number for WITHDRAWALS / DEBITS / CHECKS / FEES.
   - If the statement separates "Debit" and "Credit" columns, use that to determine sign.
5. Ignore summaries, total balances, and page headers/footers.
`;

const BANK_STATEMENT_SCHEMA: Schema = {
  type: Type.OBJECT,
  properties: {
    transactions: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          date: { type: Type.STRING, description: "YYYY-MM-DD" },
          description: { type: Type.STRING },
          amount: { type: Type.NUMBER, description: "Positive for credit, negative for debit" }
        },
        required: ["date", "description", "amount"]
      }
    }
  },
  required: ["transactions"]
};

const SYSTEM_INSTRUCTION = `
You are a specialized accounting assistant for a dental office using Dentrix software.
Your task is to analyze images of "Dentrix Deposit Slips" and extract the financial totals.

DATA MAPPING RULES:
1. **Insurance Checks**: Sum totals from sections labeled "Dental Ins. Check Payment", "Medical Ins. Check Payment", or generic "Insurance Payment".
2. **Patient Checks**: Sum totals from sections labeled "Check Payment" (usually personal checks, excluding insurance).
3. **Credit Cards**: Sum totals for Visa, MasterCard, American Express, Discover.
4. **Specific Financing**: 
   - Extract "CareCredit" into its own field.
   - Extract "Cherry" into its own field.
5. **Cash**: Extract "Cash Payment" totals.
6. **Date**: Extract the "Date:" field (usually top left, e.g., "05/20/2020"). Convert to YYYY-MM-DD.

IMPORTANT:
- Ignore "Item" counts (e.g. "18 Items", "22 TOTAL Items"). Only extract currency totals.
- If a section is missing (e.g. no Cash), return 0.
- Return a JSON object matching the schema.
`;

const RESPONSE_SCHEMA: Schema = {
  type: Type.OBJECT,
  properties: {
    date: { type: Type.STRING, description: "The date of the deposit slip in YYYY-MM-DD format." },
    cash: { type: Type.NUMBER, description: "Total cash amount." },
    checks: { type: Type.NUMBER, description: "Total personal/patient checks amount." },
    insuranceChecks: { type: Type.NUMBER, description: "Total insurance checks amount (Dental + Medical)." },
    creditCards: { type: Type.NUMBER, description: "Total credit card payments (Visa, MC, Amex, Discover)." },
    careCredit: { type: Type.NUMBER, description: "Total CareCredit amount." },
    cherry: { type: Type.NUMBER, description: "Total Cherry financing amount." },
    eft: { type: Type.NUMBER, description: "Total EFT/Direct Deposit amounts." },
    other: { type: Type.NUMBER, description: "Any other miscellaneous payments." }
  },
  required: ["cash", "checks", "creditCards", "careCredit"]
};

const normalizeDate = (dateStr?: string): string => {
  if (!dateStr) return new Date().toISOString().split('T')[0];

  // Handle MM/DD/YYYY format which is common in Dentrix (e.g. 05/20/2020)
  const slashMatch = dateStr.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (slashMatch) {
    const [_, m, d, y] = slashMatch;
    return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
  }

  return dateStr;
};

export const parseDepositSlip = async (base64Image: string): Promise<Partial<DepositRecord>> => {
  try {
    const provider = getProvider();
    if (provider !== 'gemini') {
      throw new Error('Only Gemini is supported right now. Switch provider back to Gemini in Settings.');
    }

    // Debug: check what's available
    const fromLocalStorage = getApiKey();
    const fromImportMeta = import.meta.env.GEMINI_API_KEY as string;

    console.log('API Key check:', {
      fromLocalStorage: fromLocalStorage ? '✓' : '✗',
      fromImportMeta: fromImportMeta ? '✓' : '✗'
    });

    const apiKey = fromLocalStorage || fromImportMeta;
    if (!apiKey) {
      throw new Error('Missing Gemini API key. Add it in Settings.');
    }

    const ai = new GoogleGenAI({ apiKey });

    // Remove header if present (e.g., "data:image/png;base64,")
    const cleanBase64 = base64Image.split(',')[1] || base64Image;

    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: {
        parts: [
          {
            inlineData: {
              mimeType: 'image/png', // Assuming PNG from canvas, but works for generic image
              data: cleanBase64
            }
          },
          {
            text: "Extract the deposit totals from this Dentrix deposit slip. Return JSON."
          }
        ]
      },
      config: {
        systemInstruction: SYSTEM_INSTRUCTION,
        responseMimeType: "application/json",
        responseSchema: RESPONSE_SCHEMA
      }
    });

    const text = response.text;
    if (!text) throw new Error("No data returned from AI");

    const data = JSON.parse(text);

    // Calculate total
    const total = (data.cash || 0) + (data.checks || 0) + (data.insuranceChecks || 0) +
      (data.creditCards || 0) + (data.careCredit || 0) + (data.cherry || 0) +
      (data.eft || 0) + (data.other || 0);

    return {
      date: normalizeDate(data.date),
      total: total,
      breakdown: {
        cash: data.cash || 0,
        checks: data.checks || 0,
        insuranceChecks: data.insuranceChecks || 0,
        creditCards: data.creditCards || 0,
        careCredit: data.careCredit || 0,
        cherry: data.cherry || 0,
        eft: data.eft || 0,
        other: data.other || 0
      }
    };

  } catch (error) {
    console.error("Gemini Extraction Error:", error);
    throw error;
  }
};

export const parseBankStatementPage = async (base64Image: string): Promise<{ date: string; description: string; amount: number }[]> => {
  try {
    const provider = getProvider();
    if (provider !== 'gemini') {
      throw new Error('Switch provider to Gemini in Settings to use PDF import.');
    }

    const apiKey = getApiKey() || (import.meta.env.GEMINI_API_KEY as string);
    if (!apiKey) throw new Error('Missing Gemini API key.');

    const ai = new GoogleGenAI({ apiKey });
    const cleanBase64 = base64Image.split(',')[1] || base64Image;

    const response = await ai.models.generateContent({
      model: 'gemini-2.0-flash-exp', // Using 1.5-pro or 1.5-flash is safer for structured data, but user specifically mentioned 'as long as ocr is accurate'
      // 2.0-flash-exp is the latest and greatest for speed/quality balance if available, otherwise 1.5-flash
      contents: {
        parts: [
          { inlineData: { mimeType: 'image/png', data: cleanBase64 } },
          { text: "Extract all transactions from this bank statement page." }
        ]
      },
      config: {
        systemInstruction: BANK_STATEMENT_INSTRUCTION,
        responseMimeType: "application/json",
        responseSchema: BANK_STATEMENT_SCHEMA
      }
    });

    const text = response.text;
    if (!text) return [];

    const data = JSON.parse(text);
    const transactions = data.transactions || [];

    return transactions.map((t: any) => ({
      date: normalizeDate(t.date),
      description: t.description || '',
      amount: t.amount || 0
    }));

  } catch (error) {
    console.error("Gemini Bank Statement Error:", error);
    // Return empty on error to allow other pages to process? Or throw?
    // Let's throw so the UI knows.
    throw error;
  }
};
