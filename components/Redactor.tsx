import React, { useRef, useState, useEffect, useCallback } from 'react';

interface RedactorProps {
  imageSrc: string;
  onProcess: (processedImage: string) => void;
  onCancel: () => void;
}

const Redactor: React.FC<RedactorProps> = ({ imageSrc, onProcess, onCancel }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [startPos, setStartPos] = useState<{ x: number; y: number } | null>(null);
  const [imageObj, setImageObj] = useState<HTMLImageElement | null>(null);
  
  // We keep a history of redaction rectangles: [x, y, w, h]
  const [rects, setRects] = useState<number[][]>([]);

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

    // Reset canvas dimensions to match image
    // We limit max width for display, but here we want to process full res if possible,
    // or a reasonable scaled version to avoid massive payloads. 
    // Let's cap width at 1024px for performance/AI token efficiency.
    const MAX_WIDTH = 1024;
    let width = imageObj.width;
    let height = imageObj.height;

    if (width > MAX_WIDTH) {
      const scale = MAX_WIDTH / width;
      width = MAX_WIDTH;
      height = height * scale;
    }

    canvas.width = width;
    canvas.height = height;

    // Draw original image
    ctx.drawImage(imageObj, 0, 0, width, height);

    // Draw all confirmed rects
    ctx.fillStyle = 'black';
    rects.forEach(r => {
      ctx.fillRect(r[0], r[1], r[2], r[3]);
    });
  }, [imageObj, rects]);

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

    // Scale mouse coordinates to canvas resolution
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;

    return {
      x: (clientX - rect.left) * scaleX,
      y: (clientY - rect.top) * scaleY
    };
  };

  const startDrawing = (e: React.MouseEvent | React.TouchEvent) => {
    e.preventDefault(); // Prevent scrolling on touch
    setIsDrawing(true);
    setStartPos(getPos(e));
  };

  const drawCurrentRect = (e: React.MouseEvent | React.TouchEvent) => {
    if (!isDrawing || !startPos || !canvasRef.current) return;
    e.preventDefault();
    
    // Redraw base
    draw(); 
    
    const ctx = canvasRef.current.getContext('2d');
    if (!ctx) return;

    const currentPos = getPos(e);
    const w = currentPos.x - startPos.x;
    const h = currentPos.y - startPos.y;

    // Draw current dragging selection (semi-transparent red for visibility while drawing)
    ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
    ctx.fillRect(startPos.x, startPos.y, w, h);
    ctx.strokeStyle = 'red';
    ctx.lineWidth = 2;
    ctx.strokeRect(startPos.x, startPos.y, w, h);
  };

  const stopDrawing = (e: React.MouseEvent | React.TouchEvent) => {
    if (!isDrawing || !startPos) return;
    e.preventDefault();

    const currentPos = getPos(e);
    const w = currentPos.x - startPos.x;
    const h = currentPos.y - startPos.y;

    // Don't save tiny accidental clicks
    if (Math.abs(w) > 5 && Math.abs(h) > 5) {
      setRects(prev => [...prev, [startPos.x, startPos.y, w, h]]);
    }

    setIsDrawing(false);
    setStartPos(null);
  };

  const handleProcess = () => {
    if (!canvasRef.current) return;
    // Export the canvas content (which now has burned-in black boxes)
    const dataUrl = canvasRef.current.toDataURL('image/png');
    onProcess(dataUrl);
  };

  const undoLast = () => {
    setRects(prev => prev.slice(0, -1));
  };

  return (
    <div className="flex flex-col h-full bg-gray-100 p-4 rounded-lg">
      <div className="flex justify-between items-center mb-4">
        <div>
          <h3 className="text-lg font-bold text-gray-800">Redact PHI</h3>
          <p className="text-sm text-gray-600">Draw boxes over patient names to hide them.</p>
        </div>
        <div className="flex space-x-2">
          <button onClick={undoLast} className="px-3 py-1 bg-gray-200 hover:bg-gray-300 rounded text-sm text-gray-700">
            <i className="fas fa-undo mr-1"></i> Undo
          </button>
          <button onClick={onCancel} className="px-3 py-1 bg-white hover:bg-red-50 text-red-600 border border-red-200 rounded text-sm">
            Cancel
          </button>
          <button onClick={handleProcess} className="px-4 py-1 bg-blue-600 hover:bg-blue-700 text-white rounded text-sm font-medium shadow">
            Process Image <i className="fas fa-arrow-right ml-1"></i>
          </button>
        </div>
      </div>
      
      <div className="flex-1 overflow-auto border-2 border-dashed border-gray-300 bg-gray-200 flex items-center justify-center relative rounded">
         <canvas
            ref={canvasRef}
            className="shadow-lg cursor-crosshair max-w-full"
            onMouseDown={startDrawing}
            onMouseMove={drawCurrentRect}
            onMouseUp={stopDrawing}
            onMouseLeave={() => setIsDrawing(false)}
            onTouchStart={startDrawing}
            onTouchMove={drawCurrentRect}
            onTouchEnd={stopDrawing}
            style={{ touchAction: 'none' }}
         />
      </div>
    </div>
  );
};

export default Redactor;
