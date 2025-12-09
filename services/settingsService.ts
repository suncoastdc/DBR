const API_KEY_KEY = 'dbr_api_key';
const PROVIDER_KEY = 'dbr_model_provider';

const safeLocalStorage = (): Storage | null => {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
};

export const getApiKey = (): string | null => {
  const ls = safeLocalStorage();
  if (!ls) return null;
  return ls.getItem(API_KEY_KEY);
};

export const setApiKey = (key: string) => {
  const ls = safeLocalStorage();
  if (!ls) return;
  if (key) ls.setItem(API_KEY_KEY, key.trim());
  else ls.removeItem(API_KEY_KEY);
};

export const getProvider = (): string => {
  const ls = safeLocalStorage();
  if (!ls) return 'gemini';
  return ls.getItem(PROVIDER_KEY) || 'gemini';
};

export const setProvider = (provider: string) => {
  const ls = safeLocalStorage();
  if (!ls) return;
  ls.setItem(PROVIDER_KEY, provider);
};
