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
    try {
      // Request display media. 
      // 'displaySurface: "monitor"' prefers full screen sharing if supported.
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
      if (err.name === 'NotAllowedError' || err.message?.includes('permission') || err.message?.includes('denied')) {
        alert("Permission denied. Please ensure you allow screen sharing when prompted.");
      }
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
      setExtractedData({ ...result, sourceImage: redactedImageBase64 });
    } catch (err) {
      alert("Failed to process image. Please try again or check your API key.");
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

  const updateBreakdown = (field: keyof DepositBreakdown, value: string) => {
    if (!extractedData || !extractedData.breakdown) return;
    const numVal = parseFloat(value) || 0;
    
    const newBreakdown = { ...extractedData.breakdown, [field]: numVal };
    const newTotal = (Object.values(newBreakdown) as number[]).reduce((a, b) => a + b, 0);

    setExtractedData({
      ...extractedData,
      breakdown: newBreakdown,
      total: newTotal
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
                onChange={(e) => setExtractedData({...extractedData, date: e.target.value})}
                className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 p-2 border"
              />
            </div>

            <h3 className="font-semibold text-gray-700 mt-4">Breakdown</h3>
            <div className="grid grid-cols-2 gap-4">
              {Object.keys(extractedData.breakdown).map((key) => (
                <div key={key}>
                  <label className="block text-xs font-medium text-gray-500 uppercase">{key.replace(/([A-Z])/g, ' $1').trim()}</label>
                  <div className="relative mt-1 rounded-md shadow-sm">
                    <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3">
                      <span className="text-gray-500 sm:text-sm">$</span>
                    </div>
                    <input
                      type="number"
                      step="0.01"
                      value={extractedData.breakdown![key as keyof DepositBreakdown]}
                      onChange={(e) => updateBreakdown(key as keyof DepositBreakdown, e.target.value)}
                      className="block w-full rounded-md border-gray-300 pl-7 focus:border-blue-500 focus:ring-blue-500 sm:text-sm p-2 border"
                    />
                  </div>
                </div>
              ))}
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
    <div className="grid grid-cols-1 md:grid-cols-2 gap-6 h-96">
      
      {/* Upload Option */}
      <div className="flex flex-col items-center justify-center border-2 border-dashed border-gray-300 rounded-lg bg-gray-50 hover:bg-gray-100 transition-colors cursor-pointer relative h-full group">
        <input 
          type="file" 
          accept="image/*" 
          onChange={handleFileChange}
          className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
        />
        <div className="text-center p-6 pointer-events-none">
          <div className="mx-auto h-16 w-16 text-gray-400 mb-4 bg-white rounded-full flex items-center justify-center shadow-sm group-hover:scale-110 transition-transform">
             <i className="fas fa-file-upload text-3xl text-blue-500"></i>
          </div>
          <h3 className="mt-2 text-sm font-medium text-gray-900">Upload File</h3>
          <p className="mt-1 text-xs text-gray-500">PNG, JPG, Screenshot</p>
          <p className="mt-2 text-xs text-blue-500 font-medium py-1 px-2 bg-blue-50 rounded">Or Press Ctrl+V to Paste</p>
        </div>
      </div>

      {/* Screen Capture Option */}
      <button 
        onClick={startCaptureSession}
        className="flex flex-col items-center justify-center border-2 border-dashed border-gray-300 rounded-lg bg-gray-50 hover:bg-blue-50 transition-colors cursor-pointer h-full group text-left"
      >
        <div className="text-center p-6">
          <div className="mx-auto h-16 w-16 text-gray-400 mb-4 bg-white rounded-full flex items-center justify-center shadow-sm group-hover:scale-110 transition-transform">
             <i className="fas fa-desktop text-3xl text-indigo-500"></i>
          </div>
          <h3 className="mt-2 text-sm font-medium text-gray-900">Capture Day Sheet</h3>
          <p className="mt-1 text-xs text-gray-500">From Screen or Window</p>
          <p className="mt-2 text-xs text-indigo-500 font-medium py-1 px-2 bg-indigo-50 rounded">Live Preview & Timer</p>
        </div>
      </button>

    </div>
  );
};

export default DepositProcessor;