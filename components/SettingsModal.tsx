import React, { useEffect, useRef, useState } from 'react';
import { ModelProvider } from '../types';
import { getApiKey, setApiKey, getProvider, setProvider } from '../services/settingsService';

interface SettingsModalProps {
  open: boolean;
  onClose: () => void;
}

const SettingsModal: React.FC<SettingsModalProps> = ({ open, onClose }) => {
  const [apiKey, setApiKeyState] = useState('');
  const [provider, setProviderState] = useState<ModelProvider>('gemini');
  const [saved, setSaved] = useState(false);
  const [checkingUpdate, setCheckingUpdate] = useState(false);
  const [updateStatus, setUpdateStatus] = useState<string | null>(null);
  const [currentVersion, setCurrentVersion] = useState<string>('unknown');
  const hasUpdaterListeners = useRef(false);
  const openRef = useRef(open);
  const currentVersionRef = useRef(currentVersion);

  useEffect(() => {
    openRef.current = open;
    if (open) {
      const effectiveKey = getApiKey() || '';
      setApiKeyState(effectiveKey);
      setProviderState((getProvider() as ModelProvider) || 'gemini');
      setSaved(false); // Reset saved state
      setUpdateStatus(null);
      setCheckingUpdate(false);
      setCurrentVersion((import.meta.env.APP_VERSION as string) || 'unknown');
    }
  }, [open]);

  useEffect(() => {
    currentVersionRef.current = currentVersion;
  }, [currentVersion]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  useEffect(() => {
    if (hasUpdaterListeners.current) return;
    if (!window.electronAPI?.updater) return;

    hasUpdaterListeners.current = true;

    const updateIfOpen = (status: string | null) => {
      if (!openRef.current) return;
      setUpdateStatus(status);
      setCheckingUpdate(false);
    };

    window.electronAPI.updater.onUpdateChecking(() => {
      if (!openRef.current) return;
      setUpdateStatus('Checking for updates...');
      setCheckingUpdate(true);
    });
    window.electronAPI.updater.onUpdateAvailable((info) => {
      updateIfOpen(`Update available: ${info.version}`);
    });
    window.electronAPI.updater.onUpdateDownloaded((info) => {
      updateIfOpen(`Update ready: ${info.version}`);
    });
    window.electronAPI.updater.onUpdateNotAvailable(() => {
      updateIfOpen(`Up to date (current ${currentVersionRef.current})`);
    });
    window.electronAPI.updater.onUpdateError((err) => {
      updateIfOpen(`Check failed: ${err}`);
    });
  }, []);

  const handleSave = () => {
    setApiKey(apiKey);
    setProvider(provider);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const handleCheckUpdate = async () => {
    setCheckingUpdate(true);
    setUpdateStatus('Checking for updates...');

    if (!window.electronAPI?.updater) {
      setUpdateStatus('Update checks are available in the desktop app only.');
      setCheckingUpdate(false);
      return;
    }

    try {
      await window.electronAPI.updater.checkForUpdates();
    } catch (err: any) {
      setUpdateStatus(`Check failed: ${err?.message || 'Unknown error'}`);
      setCheckingUpdate(false);
    }
  };

  if (!open) return null;

  const canCheckUpdates = !!window.electronAPI?.updater;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl w-full max-w-lg transition-colors duration-200">
        <div className="flex justify-between items-center px-5 py-4 border-b dark:border-gray-700">
          <h2 className="text-lg font-semibold text-gray-800 dark:text-white flex items-center gap-2">
            <i className="fas fa-cog text-blue-600 dark:text-blue-400"></i>
            Settings
          </h2>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200">
            <i className="fas fa-times"></i>
          </button>
        </div>

        <div className="p-5 space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">AI Provider</label>
            <select
              value={provider}
              onChange={e => setProviderState(e.target.value as ModelProvider)}
              className="w-full rounded border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white focus:border-blue-500 focus:ring-blue-500"
            >
              <option value="gemini">Gemini (Google)</option>
              <option value="openai" disabled>
                OpenAI / ChatGPT (not yet wired up)
              </option>
            </select>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
              Gemini is currently supported. ChatGPT support will require additional wiring.
            </p>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">API Key</label>
            <div className="relative">
              <input
                type="password"
                value={apiKey}
                onChange={e => setApiKeyState(e.target.value)}
                className={`w-full rounded border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white focus:border-blue-500 focus:ring-blue-500 px-3 py-2 ${apiKey === import.meta.env.GEMINI_API_KEY ? 'bg-blue-50 dark:bg-blue-900/40 text-blue-800 dark:text-blue-100' : ''
                  }`}
                placeholder="Paste your Gemini API key"
              />
              {apiKey === import.meta.env.GEMINI_API_KEY && (
                <div className="absolute inset-y-0 right-0 pr-3 flex items-center pointer-events-none">
                  <span className="text-xs text-blue-600 dark:text-blue-300 font-medium bg-blue-100 dark:bg-blue-900 px-2 py-0.5 rounded">Env Var</span>
                </div>
              )}
            </div>
            <p className="text-xs text-gray-500 mt-1">
              {apiKey === import.meta.env.GEMINI_API_KEY
                ? 'Using key from environment variables (.env.local).'
                : 'Key is stored locally on this device only.'}
            </p>
          </div>

          <div className="border dark:border-gray-600 rounded p-3 bg-gray-50 dark:bg-gray-700">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-semibold text-gray-800 dark:text-gray-200">Update status</p>
                <p className="text-xs text-gray-500 dark:text-gray-400">Current version: {currentVersion}</p>
              </div>
              <button
                onClick={handleCheckUpdate}
                disabled={checkingUpdate || !canCheckUpdates}
                className="px-3 py-2 text-sm bg-indigo-600 text-white rounded hover:bg-indigo-700 disabled:opacity-50"
              >
                {checkingUpdate ? 'Checking...' : 'Check for updates'}
              </button>
            </div>
            {updateStatus && (
              <div className="mt-2 text-sm text-gray-700 dark:text-gray-300">
                {updateStatus}
              </div>
            )}
            {!canCheckUpdates && (
              <div className="mt-2 text-xs text-gray-500 dark:text-gray-400">
                Update checks are available in the packaged desktop app only.
              </div>
            )}
          </div>
        </div>

        <div className="flex justify-between items-center px-5 py-4 border-t dark:border-gray-700 bg-gray-50 dark:bg-gray-700/50">
          <span className="text-sm text-gray-500 dark:text-gray-400">
            Need a key? Create one in Google AI Studio.
          </span>
          <div className="flex gap-2">
            <button
              onClick={onClose}
              className="px-4 py-2 text-sm text-gray-600 dark:text-gray-300 hover:text-gray-800 dark:hover:text-white"
            >
              Close
            </button>
            <button
              onClick={handleSave}
              className="px-4 py-2 text-sm bg-blue-600 text-white rounded shadow hover:bg-blue-700"
            >
              Save
            </button>
          </div>
        </div>
        {saved && (
          <div className="px-5 py-2 text-green-600 text-sm bg-green-50 border-t border-green-100 flex items-center gap-2">
            <i className="fas fa-check-circle"></i>
            Saved. You can close this window.
          </div>
        )}
      </div>
    </div>
  );
};

export default SettingsModal;

