import React, { useRef, useState, useEffect, useCallback } from 'react';

interface ScreenCropperProps {
  imageSrc: string;
  onCrop: (croppedImage: string) => void;
  onCancel: () => void;
}

const ScreenCropper: React.FC<ScreenCropperProps> = ({ imageSrc, onCrop, onCancel }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [startPos, setStartPos] = useState<{ x: number; y: number } | null>(null);
  const [currentPos, setCurrentPos] = useState<{ x: number; y: number } | null>(null);
  const [imageObj, setImageObj] = useState<HTMLImageElement | null>(null);
  
  // Selection rect: [x, y, w, h]
  const [selection, setSelection] = useState<number[] | null>(null);

  useEffect(() => {
    const img = new Image();
    img.src = imageSrc;
    img.onload = () => {
      setImageObj(img);
    };
  }, [imageSrc]);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || !imageObj) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Use full resolution or scaled down for display?
    // We keep full res for accuracy, but CSS handles display size.
    const width = imageObj.width;
    const height = imageObj.height;

    canvas.width = width;
    canvas.height = height;

    // 1. Draw original image dimmed
    ctx.drawImage(imageObj, 0, 0);
    
    // Overlay semi-transparent black
    ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
    ctx.fillRect(0, 0, width, height);

    let activeRect = selection;

    // If currently drawing, calculate rect from startPos to currentPos
    if (isDrawing && startPos && currentPos) {
        const w = currentPos.x - startPos.x;
        const h = currentPos.y - startPos.y;
        activeRect = [startPos.x, startPos.y, w, h];
    }

    if (activeRect) {
        const [x, y, w, h] = activeRect;
        
        // 2. Clear the selection area (make it fully transparent/show original)
        // Actually, easiest way to show "highlight" is to draw the image again inside the rect
        // clipped to that rect.
        ctx.save();
        ctx.beginPath();
        ctx.rect(x, y, w, h);
        ctx.clip();
        ctx.drawImage(imageObj, 0, 0);
        ctx.restore();

        // 3. Draw border
        ctx.strokeStyle = '#00ff00';
        ctx.lineWidth = 2;
        ctx.setLineDash([6, 3]);
        ctx.strokeRect(x, y, w, h);
    }

  }, [imageObj, selection, isDrawing, startPos, currentPos]);

  useEffect(() => {
    draw();
  }, [draw]);

  const getPos = (e: React.MouseEvent | React.TouchEvent) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    
    let clientX, clientY;
    if ('touches' in e) {
      clientX = e.touches[0].clientX;
      clientY = e.touches[0].clientY;
    } else {
      clientX = (e as React.MouseEvent).clientX;
      clientY = (e as React.MouseEvent).clientY;
    }

    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;

    return {
      x: (clientX - rect.left) * scaleX,
      y: (clientY - rect.top) * scaleY
    };
  };

  const startDrawing = (e: React.MouseEvent | React.TouchEvent) => {
    e.preventDefault();
    setIsDrawing(true);
    const pos = getPos(e);
    setStartPos(pos);
    setCurrentPos(pos);
    setSelection(null); // Clear previous selection on new drag
  };

  const drawSelection = (e: React.MouseEvent | React.TouchEvent) => {
    if (!isDrawing) return;
    e.preventDefault();
    setCurrentPos(getPos(e));
  };

  const stopDrawing = (e: React.MouseEvent | React.TouchEvent) => {
    if (!isDrawing || !startPos || !currentPos) return;
    e.preventDefault();
    
    const w = currentPos.x - startPos.x;
    const h = currentPos.y - startPos.y;

    // Ensure we have positive width/height for simpler logic later
    // but canvas rect handles negative width/height fine usually. 
    // Let's normalize for the state.
    const x = w < 0 ? startPos.x + w : startPos.x;
    const y = h < 0 ? startPos.y + h : startPos.y;
    const absW = Math.abs(w);
    const absH = Math.abs(h);

    if (absW > 10 && absH > 10) {
        setSelection([x, y, absW, absH]);
    }

    setIsDrawing(false);
    setStartPos(null);
    setCurrentPos(null);
  };

  const handleCrop = () => {
    if (!selection || !imageObj) return;
    
    const [x, y, w, h] = selection;
    
    const destCanvas = document.createElement('canvas');
    destCanvas.width = w;
    destCanvas.height = h;
    const ctx = destCanvas.getContext('2d');
    if (!ctx) return;

    ctx.drawImage(imageObj, x, y, w, h, 0, 0, w, h);
    
    onCrop(destCanvas.toDataURL('image/png'));
  };

  return (
    <div className="flex flex-col h-full bg-gray-800 p-4 rounded-lg">
      <div className="flex justify-between items-center mb-4 text-white">
        <div>
          <h3 className="text-lg font-bold">Crop Screenshot</h3>
          <p className="text-sm text-gray-300">Draw a box around the Day Sheet area.</p>
        </div>
        <div className="flex space-x-2">
          <button onClick={onCancel} className="px-3 py-1 bg-gray-600 hover:bg-gray-500 rounded text-sm">
            Cancel
          </button>
          <button 
            onClick={handleCrop} 
            disabled={!selection}
            className={`px-4 py-1 rounded text-sm font-medium shadow ${
                selection 
                ? 'bg-blue-600 hover:bg-blue-500 text-white' 
                : 'bg-gray-600 text-gray-400 cursor-not-allowed'
            }`}
          >
            Crop & Continue <i className="fas fa-arrow-right ml-1"></i>
          </button>
        </div>
      </div>
      
      <div className="flex-1 overflow-auto border border-gray-600 bg-gray-900 flex items-center justify-center relative rounded">
         <canvas
            ref={canvasRef}
            className="shadow-lg cursor-crosshair max-w-full"
            onMouseDown={startDrawing}
            onMouseMove={drawSelection}
            onMouseUp={stopDrawing}
            onMouseLeave={stopDrawing}
            onTouchStart={startDrawing}
            onTouchMove={drawSelection}
            onTouchEnd={stopDrawing}
         />
      </div>
    </div>
  );
};

export default ScreenCropper;