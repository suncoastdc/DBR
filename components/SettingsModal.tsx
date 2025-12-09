import React, { useEffect, useState } from 'react';
import { ModelProvider } from '../types';
import { getApiKey, setApiKey, getProvider, setProvider } from '../services/settingsService';
import { checkForUpdate } from '../services/updateService';

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
  const [updateUrl, setUpdateUrl] = useState<string | null>(null);
  const [currentVersion, setCurrentVersion] = useState<string>('unknown');

  useEffect(() => {
    if (open) {
      setApiKeyState(getApiKey() || '');
      setProviderState((getProvider() as ModelProvider) || 'gemini');
      setSaved(false);
      setUpdateStatus(null);
      setUpdateUrl(null);
      setCurrentVersion((import.meta.env.APP_VERSION as string) || 'unknown');
    }
  }, [open]);

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

  const handleSave = () => {
    setApiKey(apiKey);
    setProvider(provider);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const handleCheckUpdate = async () => {
    setCheckingUpdate(true);
    setUpdateStatus(null);
    try {
      const result = await checkForUpdate();
      if (result.error) {
        setUpdateStatus(`Check failed: ${result.error}`);
      } else if (result.updateAvailable && result.latest) {
        setUpdateStatus(`Update available: ${result.latest}`);
        setUpdateUrl(result.downloadUrl || null);
      } else {
        setUpdateStatus(`Up to date (current ${result.current})`);
      }
    } catch (err: any) {
      setUpdateStatus(`Check failed: ${err?.message || 'Unknown error'}`);
    } finally {
      setCheckingUpdate(false);
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-lg">
        <div className="flex justify-between items-center px-5 py-4 border-b">
          <h2 className="text-lg font-semibold text-gray-800 flex items-center gap-2">
            <i className="fas fa-cog text-blue-600"></i>
            Settings
          </h2>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-700">
            <i className="fas fa-times"></i>
          </button>
        </div>

        <div className="p-5 space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">AI Provider</label>
            <select
              value={provider}
              onChange={e => setProviderState(e.target.value as ModelProvider)}
              className="w-full rounded border-gray-300 focus:border-blue-500 focus:ring-blue-500"
            >
              <option value="gemini">Gemini (Google)</option>
              <option value="openai" disabled>
                OpenAI / ChatGPT (not yet wired up)
              </option>
            </select>
            <p className="text-xs text-gray-500 mt-1">
              Gemini is currently supported. ChatGPT support will require additional wiring.
            </p>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">API Key</label>
            <input
              type="password"
              value={apiKey}
              onChange={e => setApiKeyState(e.target.value)}
              className="w-full rounded border-gray-300 focus:border-blue-500 focus:ring-blue-500 px-3 py-2"
              placeholder="Paste your Gemini API key"
            />
            <p className="text-xs text-gray-500 mt-1">
              Key is stored locally on this device only.
            </p>
          </div>

          <div className="border rounded p-3 bg-gray-50">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-semibold text-gray-800">Update status</p>
                <p className="text-xs text-gray-500">Current version: {currentVersion}</p>
              </div>
              <button
                onClick={handleCheckUpdate}
                disabled={checkingUpdate}
                className="px-3 py-2 text-sm bg-indigo-600 text-white rounded hover:bg-indigo-700 disabled:opacity-50"
              >
                {checkingUpdate ? 'Checking…' : 'Check for updates'}
              </button>
            </div>
            {updateStatus && (
              <div className="mt-2 text-sm text-gray-700">
                {updateStatus}
                {updateUrl && (
                  <div>
                    <a
                      href={updateUrl}
                      className="text-indigo-600 underline text-xs"
                      target="_blank"
                      rel="noreferrer"
                    >
                      Download latest
                    </a>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        <div className="flex justify-between items-center px-5 py-4 border-t bg-gray-50">
          <span className="text-sm text-gray-500">
            Need a key? Create one in Google AI Studio.
          </span>
          <div className="flex gap-2">
            <button
              onClick={onClose}
              className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800"
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
