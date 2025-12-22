import React, { useState, useEffect, useRef } from 'react';
import Redactor from './Redactor';
import ScreenCropper from './ScreenCropper';
import { parseDepositSlip } from '../services/geminiService';
import { DepositRecord, DepositBreakdown } from '../types';

interface DepositProcessorProps {
  onSave: (record: DepositRecord) => void;
}

const DepositProcessor: React.FC<DepositProcessorProps> = ({ onSave }) => {
  const [file, setFile] = useState<File | null>(null);
  const [imageSrc, setImageSrc] = useState<string | null>(null); // The image to be redacted
  const [rawCaptureSrc, setRawCaptureSrc] = useState<string | null>(null); // Raw screen capture to be cropped
  const [isProcessing, setIsProcessing] = useState(false);
  const [extractedData, setExtractedData] = useState<Partial<DepositRecord> | null>(null);

  // Screen Capture State
  const [captureStream, setCaptureStream] = useState<MediaStream | null>(null);
  const [countdown, setCountdown] = useState<number | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);

  // Enable paste support globally when this component is active
  useEffect(() => {
    const handlePaste = (e: ClipboardEvent) => {
      if (captureStream) return; // Disable paste while capturing
      if (e.clipboardData && e.clipboardData.files.length > 0) {
        const pastedFile = e.clipboardData.files[0];
        if (pastedFile.type.startsWith('image/')) {
          processFile(pastedFile);
        }
      }
    };

    window.addEventListener('paste', handlePaste);
    return () => window.removeEventListener('paste', handlePaste);
  }, [captureStream]);

  // Attach stream to video element when captureStream changes
  useEffect(() => {
    if (videoRef.current && captureStream) {
      videoRef.current.srcObject = captureStream;
    }
  }, [captureStream]);

  // Clean up stream on unmount
  useEffect(() => {
    return () => {
      if (captureStream) {
        captureStream.getTracks().forEach(track => track.stop());
      }
    };
  }, [captureStream]);

  const processFile = (selectedFile: File) => {
    setFile(selectedFile);
    const reader = new FileReader();
    reader.onload = (event) => {
      if (event.target?.result) {
        // If it's a pasted image, it might be already cropped, so we go straight to redaction
        setImageSrc(event.target.result as string);
        setExtractedData(null);
        setRawCaptureSrc(null);
      }
    };
    reader.readAsDataURL(selectedFile);
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      processFile(e.target.files[0]);
    }
  };

  const startCaptureSession = async () => {
    const electronAPI = (window as any).electronAPI;
    try {
      if (electronAPI?.captureScreen) {
        const dataUrl = await electronAPI.captureScreen();
        setRawCaptureSrc(dataUrl);
        setImageSrc(null);
        setExtractedData(null);
        return;
      }

      // Request display media as a fallback in the browser context.
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: {
          displaySurface: "monitor",
          cursor: "always"
        } as any, // Type cast for non-standard constraints
        audio: false
      });

      // Handle user clicking "Stop Sharing" in browser UI
      stream.getVideoTracks()[0].onended = () => {
        setCaptureStream(null);
      };

      setCaptureStream(stream);

    } catch (err: any) {
      console.error("Screen capture cancelled or failed", err);
      alert(`Screen capture is unavailable: ${err.message || err}. You can still paste a screenshot on the left.`);
    }
  };

  const stopCaptureSession = () => {
    if (captureStream) {
      captureStream.getTracks().forEach(track => track.stop());
      setCaptureStream(null);
      setCountdown(null);
    }
  };

  const handleSnapshot = (delaySeconds: number = 0) => {
    if (!captureStream) return;

    if (delaySeconds > 0) {
      setCountdown(delaySeconds);
      let count = delaySeconds;
      const interval = setInterval(() => {
        count--;
        setCountdown(count);
        if (count <= 0) {
          clearInterval(interval);
          performCapture();
        }
      }, 1000);
    } else {
      performCapture();
    }
  };

  const performCapture = () => {
    if (!videoRef.current || !captureStream) return;

    const video = videoRef.current;
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;

    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      const dataUrl = canvas.toDataURL('image/png');

      // Stop the stream now that we have the image
      stopCaptureSession();
      setRawCaptureSrc(dataUrl);
    }
  };

  const handleCropComplete = (croppedImage: string) => {
    setImageSrc(croppedImage);
    setRawCaptureSrc(null);
  };

  const handleRedactionComplete = async (redactedImageBase64: string) => {
    setIsProcessing(true);
    try {
      const result = await parseDepositSlip(redactedImageBase64);
      // Store a thumbnail, but keeping it large enough to be readable. 1200px width.
      const compressed = await compressDataUrl(redactedImageBase64, 1200, 0.75);
      setExtractedData({ ...result, sourceImage: compressed });
    } catch (err) {
      console.error("AI processing failed", err);
      alert("Failed to process image. Please check your API key in Settings and try again.");
    } finally {
      setIsProcessing(false);
    }
  };

  const handleSave = () => {
    if (extractedData && extractedData.date && extractedData.breakdown) {
      const record: DepositRecord = {
        id: crypto.randomUUID(),
        date: extractedData.date,
        total: extractedData.total || 0,
        breakdown: extractedData.breakdown as DepositBreakdown,
        status: 'pending',
        sourceImage: extractedData.sourceImage
      };
      onSave(record);
      // Reset
      setFile(null);
      setImageSrc(null);
      setExtractedData(null);
    }
  };

  const calculateBreakdownTotal = (bd: DepositBreakdown) => {
    return (
      (bd.cash || 0) +
      (bd.checks || 0) +
      (bd.insuranceChecks || 0) +
      (bd.creditCards || 0) +
      (bd.insuranceCreditCards || 0) +
      (bd.careCredit || 0) +
      (bd.cherry || 0) +
      (bd.eft || 0) +
      (bd.other || 0)
    );
  };

  const updateBreakdown = (field: keyof DepositBreakdown, value: string) => {
    if (!extractedData || !extractedData.breakdown) return;
    const numVal = parseFloat(value) || 0;

    const newBreakdown = { ...extractedData.breakdown, [field]: numVal };
    // Only number fields contribute directly, complex fields like checkList are handled separately

    setExtractedData({
      ...extractedData,
      breakdown: newBreakdown,
      total: calculateBreakdownTotal(newBreakdown)
    });
  };

  const addCheck = () => {
    if (!extractedData?.breakdown) return;
    const currentList = extractedData.breakdown.checkList || [];
    const newList = [...currentList, 0];
    updateCheckList(newList);
  };

  const removeCheck = (index: number) => {
    if (!extractedData?.breakdown?.checkList) return;
    const newList = [...extractedData.breakdown.checkList];
    newList.splice(index, 1);
    updateCheckList(newList);
  };

  const updateCheckAmount = (index: number, value: string) => {
    if (!extractedData?.breakdown?.checkList) return;
    const newList = [...extractedData.breakdown.checkList];
    newList[index] = parseFloat(value) || 0;
    updateCheckList(newList);
  };

  const updateCheckList = (list: number[]) => {
    if (!extractedData?.breakdown) return;
    const totalChecks = list.reduce((a, b) => a + b, 0);
    const newBreakdown = {
      ...extractedData.breakdown,
      checkList: list,
      checks: totalChecks
    };
    setExtractedData({
      ...extractedData,
      breakdown: newBreakdown,
      total: calculateBreakdownTotal(newBreakdown)
    });
  };

  const updateCreditCardBreakdown = (type: 'visa' | 'masterCard' | 'amex' | 'discover', value: string) => {
    if (!extractedData?.breakdown) return;
    const currentCC = extractedData.breakdown.creditCardBreakdown || { visa: 0, masterCard: 0, amex: 0, discover: 0 };
    const newCC = { ...currentCC, [type]: parseFloat(value) || 0 };

    const totalCC = (newCC.visa || 0) + (newCC.masterCard || 0) + (newCC.amex || 0) + (newCC.discover || 0);

    const newBreakdown = {
      ...extractedData.breakdown,
      creditCardBreakdown: newCC,
      creditCards: totalCC
    };

    setExtractedData({
      ...extractedData,
      breakdown: newBreakdown,
      total: calculateBreakdownTotal(newBreakdown)
    });
  };

  // Phase 1.2: Live Capture Preview
  if (captureStream) {
    return (
      <div className="flex flex-col h-full bg-gray-900 rounded-lg overflow-hidden relative">
        {/* Header */}
        <div className="bg-gray-800 p-4 flex justify-between items-center text-white z-10 shadow-md">
          <div>
            <h3 className="text-lg font-bold flex items-center">
              <span className="w-3 h-3 bg-red-500 rounded-full mr-2 animate-pulse"></span>
              Live Screen Preview
            </h3>
            <p className="text-sm text-gray-400">Navigate to the Dentrix Day Sheet window.</p>
          </div>
          <button onClick={stopCaptureSession} className="px-3 py-1 bg-gray-700 hover:bg-gray-600 rounded text-sm text-gray-200">
            Cancel
          </button>
        </div>

        {/* Video Area */}
        <div className="flex-1 flex items-center justify-center bg-black overflow-hidden relative">
          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted
            className="max-w-full max-h-full object-contain"
          />

          {/* Countdown Overlay */}
          {countdown !== null && (
            <div className="absolute inset-0 bg-black/50 flex items-center justify-center z-20">
              <div className="text-9xl font-bold text-white animate-ping-slow">{countdown}</div>
            </div>
          )}
        </div>

        {/* Controls */}
        <div className="bg-gray-800 p-6 flex justify-center space-x-6 z-10">
          <button
            onClick={() => handleSnapshot(3)}
            className="flex flex-col items-center group"
            disabled={countdown !== null}
          >
            <div className="w-16 h-16 rounded-full bg-blue-600 group-hover:bg-blue-500 flex items-center justify-center shadow-lg transition-transform group-hover:scale-105 mb-2">
              <i className="fas fa-stopwatch text-2xl text-white"></i>
            </div>
            <span className="text-white text-sm font-medium">Snap in 3s</span>
            <span className="text-xs text-gray-400">Gives time to switch windows</span>
          </button>

          <button
            onClick={() => handleSnapshot(0)}
            className="flex flex-col items-center group"
            disabled={countdown !== null}
          >
            <div className="w-16 h-16 rounded-full bg-white group-hover:bg-gray-200 flex items-center justify-center shadow-lg transition-transform group-hover:scale-105 mb-2 border-4 border-gray-300">
              <div className="w-12 h-12 rounded-full bg-red-600"></div>
            </div>
            <span className="text-white text-sm font-medium">Snap Now</span>
          </button>
        </div>
      </div>
    );
  }

  if (isProcessing) {
    return (
      <div className="flex flex-col items-center justify-center h-96">
        <div className="animate-spin rounded-full h-16 w-16 border-t-4 border-b-4 border-blue-600 mb-4"></div>
        <p className="text-lg text-gray-700 font-medium">Analyzing with Gemini AI...</p>
        <p className="text-sm text-gray-500">Extracting totals from the deposit slip.</p>
      </div>
    );
  }

  // Phase 3: Review and Edit
  if (extractedData && extractedData.breakdown) {
    return (
      <div className="max-w-4xl mx-auto p-6 bg-white shadow rounded-lg animate-fade-in">
        <h2 className="text-2xl font-bold mb-6 text-gray-800 border-b pb-2">Review Extracted Data</h2>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
          {/* Form */}
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700">Date</label>
              <input
                type="date"
                value={extractedData.date}
                onChange={(e) => setExtractedData({ ...extractedData, date: e.target.value })}
                className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 p-2 border"
              />
            </div>

            <h3 className="font-semibold text-gray-700 mt-4">Breakdown</h3>
            <div className="space-y-4">
              {/* Cash - Simple Field */}
              <div>
                <label className="block text-xs font-medium text-gray-500 uppercase">Cash Payment</label>
                <div className="relative mt-1 rounded-md shadow-sm">
                  <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3"><span className="text-gray-500 sm:text-sm">$</span></div>
                  <input
                    type="number" step="0.01"
                    value={extractedData.breakdown.cash}
                    onChange={(e) => updateBreakdown('cash', e.target.value)}
                    className="block w-full rounded-md border-gray-300 pl-7 focus:border-blue-500 focus:ring-blue-500 sm:text-sm p-2 border"
                  />
                </div>
              </div>

              {/* Checks - Detailed Field */}
              <div className="bg-gray-50 p-3 rounded border border-gray-200">
                <div className="flex justify-between items-end mb-2">
                  <label className="block text-xs font-medium text-gray-500 uppercase">Check Payment</label>
                  <button onClick={addCheck} className="text-xs text-blue-600 hover:text-blue-800 underline">+ Add Check</button>
                </div>

                {/* Check List */}
                {extractedData.breakdown.checkList && extractedData.breakdown.checkList.length > 0 && (
                  <div className="space-y-2 mb-2 pl-2 border-l-2 border-gray-300">
                    {extractedData.breakdown.checkList.map((amt, idx) => (
                      <div key={idx} className="flex gap-2 items-center">
                        <span className="text-xs text-gray-400 w-4 text-right">{idx + 1}.</span>
                        <div className="relative rounded-md shadow-sm flex-1">
                          <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-2"><span className="text-gray-500 text-xs">$</span></div>
                          <input
                            type="number" step="0.01"
                            value={amt}
                            onChange={(e) => updateCheckAmount(idx, e.target.value)}
                            className="block w-full rounded border-gray-300 pl-5 py-1 text-sm border"
                            placeholder="0.00"
                          />
                        </div>
                        <button onClick={() => removeCheck(idx)} className="text-red-400 hover:text-red-600"><i className="fas fa-times"></i></button>
                      </div>
                    ))}
                  </div>
                )}

                {/* Checks Total */}
                <div className="relative mt-1 rounded-md shadow-sm">
                  <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3"><span className="text-gray-500 sm:text-sm">$</span></div>
                  <input
                    type="number" step="0.01"
                    value={extractedData.breakdown.checks}
                    onChange={(e) => updateBreakdown('checks', e.target.value)}
                    readOnly={!!(extractedData.breakdown.checkList && extractedData.breakdown.checkList.length > 0)}
                    className={`block w-full rounded-md border-gray-300 pl-7 focus:border-blue-500 focus:ring-blue-500 sm:text-sm p-2 border ${extractedData.breakdown.checkList?.length ? 'bg-gray-100 text-gray-500' : ''}`}
                  />
                </div>
              </div>

              {/* Insurance Checks - Simple Field */}
              <div>
                <label className="block text-xs font-medium text-gray-500 uppercase">Dental Ins Check</label>
                <div className="relative mt-1 rounded-md shadow-sm">
                  <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3"><span className="text-gray-500 sm:text-sm">$</span></div>
                  <input
                    type="number" step="0.01"
                    value={extractedData.breakdown.insuranceChecks}
                    onChange={(e) => updateBreakdown('insuranceChecks', e.target.value)}
                    className="block w-full rounded-md border-gray-300 pl-7 focus:border-blue-500 focus:ring-blue-500 sm:text-sm p-2 border"
                  />
                </div>
              </div>

              {/* Credit Cards - Detailed Field */}
              <div className="bg-gray-50 p-3 rounded border border-gray-200">
                <label className="block text-xs font-medium text-gray-500 uppercase mb-2">Credit Card Payment Breakdown</label>
                <div className="grid grid-cols-2 gap-2 mb-2">
                  {['visa', 'masterCard', 'amex', 'discover'].map((type) => (
                    <div key={type}>
                      <span className="text-[10px] text-gray-400 uppercase">{type}</span>
                      <div className="relative rounded-md shadow-sm">
                        <input
                          type="number" step="0.01" placeholder="0.00"
                          value={extractedData.breakdown?.creditCardBreakdown?.[type as any] || ''}
                          onChange={(e) => updateCreditCardBreakdown(type as any, e.target.value)}
                          className="block w-full rounded border-gray-300 py-1 px-2 text-sm border"
                        />
                      </div>
                    </div>
                  ))}
                </div>
                <div className="relative mt-1 rounded-md shadow-sm">
                  <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3"><span className="text-gray-500 sm:text-sm">Total: $</span></div>
                  <input
                    type="number" step="0.01"
                    value={extractedData.breakdown.creditCards}
                    onChange={(e) => updateBreakdown('creditCards', e.target.value)}
                    readOnly={true} // Always derived from breakdown? Or allow override? Plan said "Auto-calculate". I'll make it readOnly to force usage of breakdown.
                    className="block w-full rounded-md border-gray-300 pl-16 focus:border-blue-500 focus:ring-blue-500 sm:text-sm p-2 border bg-gray-100 text-gray-600 font-bold"
                  />
                </div>
              </div>

              {/* Dental Insurance Credit Cards */}
              <div className="mt-4">
                <label className="block text-xs font-medium text-gray-500 uppercase">Dental Ins Credit Card</label>
                <div className="relative mt-1 rounded-md shadow-sm">
                  <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3"><span className="text-gray-500 sm:text-sm">$</span></div>
                  <input
                    type="number" step="0.01"
                    value={extractedData.breakdown.insuranceCreditCards}
                    onChange={(e) => updateBreakdown('insuranceCreditCards', e.target.value)}
                    className="block w-full rounded-md border-gray-300 pl-7 focus:border-blue-500 focus:ring-blue-500 sm:text-sm p-2 border"
                  />
                </div>
              </div>

              {/* Other Fields */}
              <div className="grid grid-cols-2 gap-4 mt-4">
                {['careCredit', 'cherry', 'eft', 'other'].map(key => {
                  let label = key;
                  if (key === 'careCredit') label = 'CareCredit';
                  else if (key === 'cherry') label = 'Cherry';
                  else if (key === 'eft') label = 'EFT';
                  else if (key === 'other') label = 'Other';

                  return (
                    <div key={key}>
                      <label className="block text-xs font-medium text-gray-500 uppercase">{label}</label>
                      <div className="relative mt-1 rounded-md shadow-sm">
                        <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3"><span className="text-gray-500 sm:text-sm">$</span></div>
                        <input
                          type="number" step="0.01"
                          value={extractedData.breakdown![key as keyof DepositBreakdown] as number}
                          onChange={(e) => updateBreakdown(key as keyof DepositBreakdown, e.target.value)}
                          className="block w-full rounded-md border-gray-300 pl-7 focus:border-blue-500 focus:ring-blue-500 sm:text-sm p-2 border"
                        />
                      </div>
                    </div>
                  );
                })}
              </div>

            </div>

            <div className="pt-4 border-t mt-4">
              <div className="flex justify-between items-center text-lg font-bold">
                <span>Total Deposit:</span>
                <span className="text-green-600">${extractedData.total?.toFixed(2)}</span>
              </div>
            </div>

            <div className="flex gap-3 mt-6">
              <button onClick={() => setExtractedData(null)} className="flex-1 py-2 border border-gray-300 rounded text-gray-600 hover:bg-gray-50">Back</button>
              <button onClick={handleSave} className="flex-1 py-2 bg-green-600 text-white rounded hover:bg-green-700 font-medium">Confirm & Save</button>
            </div>
          </div>

          {/* Image Preview */}
          <div className="bg-gray-100 p-4 rounded flex items-center justify-center">
            <img src={extractedData.sourceImage} alt="Redacted Source" className="max-w-full max-h-[600px] object-contain shadow-sm border" />
          </div>
        </div>
      </div>
    );
  }

  // Phase 1.5: Crop Screen Capture
  if (rawCaptureSrc) {
    return <ScreenCropper imageSrc={rawCaptureSrc} onCrop={handleCropComplete} onCancel={() => setRawCaptureSrc(null)} />;
  }

  // Phase 2: Redaction
  if (imageSrc) {
    return <Redactor imageSrc={imageSrc} onProcess={handleRedactionComplete} onCancel={() => setImageSrc(null)} />;
  }

  // Phase 1: Upload or Capture
  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-6 h-96">

      {/* Screen Capture Option (primary) */}
      <button
        onClick={startCaptureSession}
        className="flex flex-col items-center justify-center border-2 border-dashed border-blue-500 dark:border-blue-600 rounded-lg bg-blue-50 dark:bg-blue-900/20 hover:bg-blue-100 dark:hover:bg-blue-900/40 transition-colors cursor-pointer h-full group text-left col-span-2"
      >
        <div className="text-center p-6">
          <div className="mx-auto h-16 w-16 text-gray-50 mb-4 bg-blue-600 rounded-full flex items-center justify-center shadow-sm group-hover:scale-110 transition-transform">
            <i className="fas fa-desktop text-3xl text-white"></i>
          </div>
          <h3 className="mt-2 text-base font-semibold text-blue-900 dark:text-blue-100">Capture Day Sheet (Recommended)</h3>
          <p className="mt-1 text-xs text-blue-900/80 dark:text-blue-200">Live preview & timer. Keeps PHI local before redaction.</p>
          <p className="mt-2 text-xs text-blue-900 dark:text-blue-100 font-medium py-1 px-2 bg-white/70 dark:bg-black/30 rounded">Click to capture</p>
        </div>
      </button>

      {/* Upload Option (fallback) */}
      <div className="flex flex-col items-center justify-center border-2 border-dashed border-gray-300 dark:border-gray-600 rounded-lg bg-gray-50 dark:bg-gray-800 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors cursor-pointer relative h-full group">
        <input
          type="file"
          accept="image/*"
          onChange={handleFileChange}
          className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
        />
        <div className="text-center p-6 pointer-events-none">
          <div className="mx-auto h-16 w-16 text-gray-400 dark:text-gray-500 mb-4 bg-white dark:bg-gray-700 rounded-full flex items-center justify-center shadow-sm group-hover:scale-110 transition-transform">
            <i className="fas fa-file-upload text-3xl text-blue-500 dark:text-blue-400"></i>
          </div>
          <h3 className="mt-2 text-sm font-medium text-gray-900 dark:text-white">Upload File</h3>
          <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">PNG, JPG, Screenshot</p>
          <p className="mt-2 text-xs text-blue-500 dark:text-blue-400 font-medium py-1 px-2 bg-blue-50 dark:bg-blue-900/30 rounded">Or Press Ctrl+V to Paste</p>
        </div>
      </div>
    </div>
  );
};

export default DepositProcessor;

// Downscale/compress data URLs to keep localStorage usage low (~tens of KB).
function compressDataUrl(dataUrl: string, maxSize = 400, quality = 0.6): Promise<string> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, maxSize / Math.max(img.width, img.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(img.width * scale));
      canvas.height = Math.max(1, Math.round(img.height * scale));
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        resolve(dataUrl);
        return;
      }
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      try {
        const jpeg = canvas.toDataURL('image/jpeg', quality);
        resolve(jpeg);
      } catch {
        resolve(dataUrl);
      }
    };
    img.onerror = () => resolve(dataUrl);
    img.src = dataUrl;
  });
}
