import React, { useState, useRef, useCallback } from 'react';
import { X, Scissors, Loader2, AlertTriangle } from 'lucide-react';
import { FILE_API_URL, IMAGE_BASE_URL } from '../config';
import { useUser } from '../contexts/UserContext';
import { fetchWithTimeout, getAuthHeaders } from '../utils/fetchWithTimeout';

interface Props {
  workId: string;
  pageNum: number;
  imageFilename: string;   // nt "1632-slug-abc.jpg"
  imageToken: { exp: number; sig: string } | null;
  onClose: () => void;
  onSuccess: () => void;
}

const SplitPageModal: React.FC<Props> = ({
  workId, pageNum, imageFilename, imageToken, onClose, onSuccess,
}) => {
  const { authToken } = useUser();
  const [splitX, setSplitX] = useState(0.5);
  const [isDragging, setIsDragging] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const imageUrl = (() => {
    const base = `${IMAGE_BASE_URL}/${workId}/${imageFilename}`;
    return imageToken
      ? `${base}?exp=${imageToken.exp}&sig=${imageToken.sig}`
      : base;
  })();

  const updateSplitX = useCallback((clientX: number) => {
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const x = (clientX - rect.left) / rect.width;
    setSplitX(Math.max(0.05, Math.min(0.95, x)));
  }, []);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (isDragging) updateSplitX(e.clientX);
  }, [isDragging, updateSplitX]);

  const handleSplit = async () => {
    if (!authToken) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetchWithTimeout(
        `${FILE_API_URL}/admin/work/${workId}/page/${pageNum}/split`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...getAuthHeaders(authToken) },
          body: JSON.stringify({ split_x: splitX }),
          timeout: 30000,
        }
      );
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || `HTTP ${res.status}`);
      }
      onSuccess();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Lõikamine ebaõnnestus');
      setSaving(false);
      setShowConfirm(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-3xl flex flex-col max-h-[90vh]">

        {/* Päis */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 flex-shrink-0">
          <div className="flex items-center gap-2">
            <Scissors size={18} className="text-amber-600" />
            <h2 className="font-semibold text-gray-900">Lõika leht {pageNum} kaheks</h2>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 transition-colors">
            <X size={20} />
          </button>
        </div>

        {/* Pildi ala */}
        <div className="flex-1 overflow-auto p-4">
          <p className="text-sm text-gray-500 mb-3">
            Lohista joont lõikekoha määramiseks.{' '}
            <span className="font-medium text-gray-700">{Math.round(splitX * 100)}%</span>
          </p>

          {/* Draggable image container */}
          <div
            ref={containerRef}
            className="relative select-none cursor-col-resize overflow-hidden rounded border border-gray-200"
            onMouseMove={handleMouseMove}
            onMouseUp={() => setIsDragging(false)}
            onMouseLeave={() => setIsDragging(false)}
          >
            <img
              src={imageUrl}
              alt={`Leht ${pageNum}`}
              className="w-full h-auto block pointer-events-none"
              draggable={false}
              onError={(e) => { (e.target as HTMLImageElement).style.opacity = '0.3'; }}
            />

            {/* Lõikejoon */}
            <div
              className="absolute top-0 bottom-0 w-0.5 bg-red-500 opacity-90 pointer-events-none"
              style={{ left: `${splitX * 100}%` }}
            />

            {/* Drag handle */}
            <div
              className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-5 h-10 bg-red-500 rounded cursor-col-resize flex items-center justify-center shadow-md"
              style={{ left: `${splitX * 100}%` }}
              onMouseDown={(e) => { e.preventDefault(); setIsDragging(true); }}
            >
              <div className="w-0.5 h-6 bg-white/70 mx-0.5" />
              <div className="w-0.5 h-6 bg-white/70 mx-0.5" />
            </div>
          </div>
        </div>

        {/* Jalus */}
        <div className="px-5 py-4 border-t border-gray-100 flex-shrink-0">
          {error && (
            <div className="flex items-center gap-2 mb-3 p-3 bg-red-50 border border-red-200 rounded text-sm text-red-700">
              <AlertTriangle size={14} />
              {error}
            </div>
          )}

          {!showConfirm ? (
            <div className="flex justify-end gap-2">
              <button
                onClick={onClose}
                className="px-4 py-2 text-sm border border-gray-300 text-gray-600 rounded hover:bg-gray-50 transition-colors"
              >
                Tühista
              </button>
              <button
                onClick={() => setShowConfirm(true)}
                className="flex items-center gap-2 px-4 py-2 text-sm bg-amber-500 hover:bg-amber-600 text-white rounded transition-colors"
              >
                <Scissors size={14} />
                Lõika leht
              </button>
            </div>
          ) : (
            <div className="space-y-3">
              <p className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded p-3">
                Originaalleht asendatakse kahe uue lehega ({Math.round(splitX * 100)}% / {100 - Math.round(splitX * 100)}%).
                Tekst ja metaandmed kopeeritakse mõlemale. Kas jätkata?
              </p>
              <div className="flex justify-end gap-2">
                <button
                  onClick={() => setShowConfirm(false)}
                  disabled={saving}
                  className="px-4 py-2 text-sm border border-gray-300 text-gray-600 rounded hover:bg-gray-50 disabled:opacity-50 transition-colors"
                >
                  Tagasi
                </button>
                <button
                  onClick={handleSplit}
                  disabled={saving}
                  className="flex items-center gap-2 px-4 py-2 text-sm bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white rounded transition-colors"
                >
                  {saving ? <Loader2 size={14} className="animate-spin" /> : <Scissors size={14} />}
                  {saving ? 'Lõikan...' : 'Jah, lõika'}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default SplitPageModal;
