import React, { useState, useRef, useEffect } from 'react';
import { ZoomIn, ZoomOut, RotateCcw, Move } from 'lucide-react';

interface ImageViewerProps {
  src: string;
}

const ImageViewer: React.FC<ImageViewerProps> = ({ src }) => {
  const [scale, setScale] = useState(1);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const containerRef = useRef<HTMLDivElement>(null);

  const handleZoom = (delta: number) => {
    setScale(prev => Math.max(0.5, Math.min(5, prev + delta)));
  };

  const handleReset = () => {
    setScale(1);
    setPosition({ x: 0, y: 0 });
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    setIsDragging(true);
    setDragStart({ x: e.clientX - position.x, y: e.clientY - position.y });
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (isDragging) {
      setPosition({
        x: e.clientX - dragStart.x,
        y: e.clientY - dragStart.y
      });
    }
  };

  const handleMouseUp = () => {
    setIsDragging(false);
  };

  const handleWheel = (e: React.WheelEvent) => {
      // Simple wheel zoom
      const delta = -e.deltaY * 0.002;
      handleZoom(delta);
  }

  // Prevent default browser drag behavior on image
  const preventDrag = (e: React.DragEvent) => {
      e.preventDefault();
  }

  return (
    <div className="h-full w-full bg-slate-900 relative overflow-hidden flex flex-col select-none">
       {/* Controls */}
       <div className="absolute top-4 left-4 z-10 flex gap-2">
          <div className="bg-black/50 backdrop-blur-md rounded-lg p-1 flex gap-1 shadow-lg border border-white/10">
            <button 
                onClick={() => handleZoom(0.25)} 
                className="p-2 text-white hover:bg-white/20 rounded transition-colors"
                title="Suumi sisse"
            >
                <ZoomIn size={20} />
            </button>
            <button 
                onClick={() => handleZoom(-0.25)} 
                className="p-2 text-white hover:bg-white/20 rounded transition-colors"
                title="Suumi välja"
            >
                <ZoomOut size={20} />
            </button>
            <button 
                onClick={handleReset} 
                className="p-2 text-white hover:bg-white/20 rounded transition-colors"
                title="Taasta vaade"
            >
                <RotateCcw size={20} />
            </button>
          </div>
       </div>

       {/* Image Container */}
       <div 
         ref={containerRef}
         className="flex-1 overflow-hidden flex items-center justify-center cursor-move"
         onMouseDown={handleMouseDown}
         onMouseMove={handleMouseMove}
         onMouseUp={handleMouseUp}
         onMouseLeave={handleMouseUp}
         onWheel={handleWheel}
       >
         <div 
            style={{
                transform: `translate(${position.x}px, ${position.y}px) scale(${scale})`,
                transition: isDragging ? 'none' : 'transform 0.1s ease-out',
                transformOrigin: 'center center'
            }}
            className="will-change-transform"
         >
            <img 
                src={src} 
                alt="Faksiimile" 
                className="max-w-none shadow-2xl sepia-[0.3] pointer-events-none" 
                style={{ maxHeight: '85vh', maxWidth: '85vw' }}
                onDragStart={preventDrag}
            />
         </div>
       </div>
       
       <div className="absolute bottom-4 right-4 text-white/50 text-xs pointer-events-none bg-black/20 px-2 py-1 rounded">
            {Math.round(scale * 100)}%
       </div>
    </div>
  );
};

export default ImageViewer;