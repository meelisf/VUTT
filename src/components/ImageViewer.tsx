import React, { useState, useRef, useEffect } from 'react';
import { ZoomIn, ZoomOut, RotateCcw, Move, Download } from 'lucide-react';
import { fetchWithTimeout } from '../utils/fetchWithTimeout';

interface ImageViewerProps {
  src: string;
}

const ImageViewer: React.FC<ImageViewerProps> = ({ src }) => {
  const [scale, setScale] = useState(1);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const containerRef = useRef<HTMLDivElement>(null);

  // Puuteekraani pinch-to-zoom ja drag tugi
  const touchStateRef = useRef<{
    lastDist: number;
    lastScale: number;
    lastCenter: { x: number; y: number };
    lastPos: { x: number; y: number };
    isTouching: boolean;
  }>({ lastDist: 0, lastScale: 1, lastCenter: { x: 0, y: 0 }, lastPos: { x: 0, y: 0 }, isTouching: false });

  const handleZoom = (delta: number) => {
    setScale(prev => Math.max(0.5, Math.min(5, prev + delta)));
  };

  const handleReset = () => {
    setScale(1);
    setPosition({ x: 0, y: 0 });
  };

  const handleDownload = async () => {
    if (!src) return;
    try {
      const response = await fetchWithTimeout(src, { timeout: 30000 });
      if (!response.ok) throw new Error("Fetch failed");
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      const filename = src.split('/').pop() || 'image.jpg';
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);
    } catch (e) {
      console.warn("Otse allalaadimine ebaõnnestus, avan uuel vahelehel.", e);
      window.open(src, '_blank');
    }
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

  // Puuteekraani sündmuste käsitlejad
  const getTouchDist = (t1: React.Touch, t2: React.Touch) =>
    Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY);

  const getTouchCenter = (t1: React.Touch, t2: React.Touch) => ({
    x: (t1.clientX + t2.clientX) / 2,
    y: (t1.clientY + t2.clientY) / 2,
  });

  const handleTouchStart = (e: React.TouchEvent) => {
    const ts = touchStateRef.current;
    if (e.touches.length === 1) {
      // Ühe sõrmega lohistamine
      ts.isTouching = true;
      ts.lastCenter = { x: e.touches[0].clientX, y: e.touches[0].clientY };
      ts.lastPos = { ...position };
    } else if (e.touches.length === 2) {
      // Kahe sõrmega pinch
      ts.lastDist = getTouchDist(e.touches[0], e.touches[1]);
      ts.lastScale = scale;
      ts.lastCenter = getTouchCenter(e.touches[0], e.touches[1]);
      ts.lastPos = { ...position };
    }
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    e.preventDefault(); // Blokeeri brauseri vaikimisi scroll/zoom
    const ts = touchStateRef.current;

    if (e.touches.length === 1 && ts.isTouching) {
      // Ühe sõrmega lohistamine
      const dx = e.touches[0].clientX - ts.lastCenter.x;
      const dy = e.touches[0].clientY - ts.lastCenter.y;
      setPosition({ x: ts.lastPos.x + dx, y: ts.lastPos.y + dy });
    } else if (e.touches.length === 2) {
      const newDist = getTouchDist(e.touches[0], e.touches[1]);
      const newCenter = getTouchCenter(e.touches[0], e.touches[1]);

      // Skaala muutus
      const ratio = newDist / ts.lastDist;
      const newScale = Math.max(0.5, Math.min(5, ts.lastScale * ratio));
      setScale(newScale);

      // Panniga liikumine pinch ajal
      const dx = newCenter.x - ts.lastCenter.x;
      const dy = newCenter.y - ts.lastCenter.y;
      setPosition({ x: ts.lastPos.x + dx, y: ts.lastPos.y + dy });
    }
  };

  const handleTouchEnd = () => {
    touchStateRef.current.isTouching = false;
  };

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
          <div className="w-px bg-white/20 mx-1"></div>
          <button
            onClick={handleDownload}
            className="p-2 text-white hover:bg-white/20 rounded transition-colors"
            title="Lae pilt alla"
          >
            <Download size={20} />
          </button>
        </div>
      </div>

      {/* Image Container */}
      <div
        ref={containerRef}
        className="flex-1 overflow-hidden flex items-center justify-center cursor-move"
        style={{ touchAction: 'none' }}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        onWheel={handleWheel}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
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