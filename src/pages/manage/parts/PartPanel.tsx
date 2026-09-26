/**
 * Osa hõljuv paneel (#464): päisest lohistatav, kokkutõmmatav, ILMA tumendava
 * taustakihita — ruudustik jääb all kasutatavaks (lehti saab valida ja osale lisada).
 * Laius sama mis metaandmete modaalil. `z-[1300]`: päis on z-[1200].
 */
import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { GripHorizontal, Maximize2, Minus, X } from 'lucide-react';
import { useDraggablePosition } from '../../../hooks/useDraggablePosition';

interface Props {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}

const PartPanel: React.FC<Props> = ({ title, onClose, children }) => {
  const { t } = useTranslation(['workspace']);
  const drag = useDraggablePosition({ anchor: 'right', storageKey: 'vutt_parts_panel_pos' });
  const [minimized, setMinimized] = useState(false);
  return (
    <div
      ref={drag.ref}
      role="dialog"
      aria-modal="false"
      aria-label={title}
      style={drag.style}
      className="z-[1300] flex w-[min(42rem,calc(100vw-2rem))] max-h-[85vh] flex-col overflow-hidden rounded-lg border border-gray-200 bg-white shadow-2xl"
    >
      <div
        className="flex shrink-0 cursor-grab select-none items-center gap-2 border-b border-gray-200 bg-gray-50 px-4 py-2.5 active:cursor-grabbing"
        onMouseDown={drag.onHandleMouseDown}
        title={t('manage.parts.dragHint')}
      >
        <GripHorizontal size={16} className="shrink-0 text-gray-400" />
        <h3 className="min-w-0 flex-1 truncate font-bold text-gray-800">{title}</h3>
        <button type="button" onClick={() => setMinimized(m => !m)}
          aria-label={t(minimized ? 'manage.parts.expand' : 'manage.parts.minimize')}
          title={t(minimized ? 'manage.parts.expand' : 'manage.parts.minimize')}
          className="rounded p-1 text-gray-400 hover:bg-gray-200 hover:text-gray-600">
          {minimized ? <Maximize2 size={16} /> : <Minus size={16} />}
        </button>
        <button type="button" onClick={onClose} aria-label={t('manage.parts.close')} title={t('manage.parts.close')}
          className="rounded p-1 text-gray-400 hover:bg-gray-200 hover:text-gray-600">
          <X size={18} />
        </button>
      </div>
      {!minimized && <div className="flex-1 overflow-y-auto p-4">{children}</div>}
    </div>
  );
};

export default PartPanel;
