import React from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import type { ExemplarImage } from '../../services/exemplarImagesService';
import { getExemplarImageUrl } from '../../services/workImageService';
import { withImageToken, type ImageToken } from '../../utils/imageTokenUrl';

export interface WitnessPage {
  pageNum: number;
  stem: string;
  imageUrl: string;
}

interface ExemplarCompareProps {
  workId: string;
  exemplarId: string;
  image: ExemplarImage;
  /** Tekstitunnistaja lehed teose järjekorras. */
  pages: WitnessPage[];
  /** Paremal näidatav tüvi (`?compare=`); olematu → „paar puudub". */
  stem: string | null;
  onStemChange: (stem: string) => void;
  /** Valitud tüvi pildi `page`-iks. */
  onSavePair: (stem: string) => Promise<void>;
  canEdit: boolean;
  imageToken: ImageToken | null;
}

/**
 * Kõrvutamine (ADR 0079): vasakul eksemplari pilt, paremal tekstitunnistaja leht.
 * Parem pool liigub nooltega sõltumatult; paar on ainult mugavus, mitte sünk.
 */
const ExemplarCompare: React.FC<ExemplarCompareProps> = ({
  workId, exemplarId, image, pages, stem, onStemChange, onSavePair, canEdit, imageToken,
}) => {
  const { t } = useTranslation(['workspace']);
  const idx = stem ? pages.findIndex(p => p.stem === stem) : -1;
  const current = idx >= 0 ? pages[idx] : null;
  const [saving, setSaving] = React.useState(false);

  const go = (delta: number) => {
    // Paarita pildilt alustab nool esimesest lehest.
    const next = idx < 0 ? 0 : idx + delta;
    if (next >= 0 && next < pages.length) onStemChange(pages[next].stem);
  };

  const save = async () => {
    if (!current) return;
    setSaving(true);
    try { await onSavePair(current.stem); } finally { setSaving(false); }
  };

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
      <div className="bg-slate-900 rounded overflow-hidden h-[70vh] flex items-center justify-center">
        <img
          data-testid="compare-exemplar"
          src={withImageToken(getExemplarImageUrl(workId, exemplarId, image.id), imageToken)}
          alt={image.label || ''}
          className="max-h-full max-w-full object-contain"
        />
      </div>
      <div className="flex flex-col h-[70vh]">
        <div className="flex items-center gap-2 mb-2 text-sm">
          <span className="font-medium text-gray-700">{t('exemplarImages.compare.witness')}</span>
          <button type="button" aria-label={t('exemplarImages.compare.prev')} onClick={() => go(-1)}
            disabled={idx === 0} className="p-1 rounded hover:bg-gray-200 disabled:opacity-30">
            <ChevronLeft className="w-4 h-4" />
          </button>
          <span className="text-gray-600 min-w-[3rem] text-center">
            {current ? t('exemplarImages.compare.page', { n: current.pageNum }) : '—'}
          </span>
          <button type="button" aria-label={t('exemplarImages.compare.next')} onClick={() => go(1)}
            disabled={idx === pages.length - 1} className="p-1 rounded hover:bg-gray-200 disabled:opacity-30">
            <ChevronRight className="w-4 h-4" />
          </button>
          {canEdit && current && current.stem !== image.page && (
            <button type="button" onClick={save} disabled={saving}
              className="ml-auto px-3 py-1 rounded bg-primary-600 text-white hover:bg-primary-700 disabled:opacity-50">
              {t('exemplarImages.compare.savePair')}
            </button>
          )}
        </div>
        <div className="flex-1 bg-slate-900 rounded overflow-hidden flex items-center justify-center">
          {current ? (
            <img data-testid="compare-witness" src={withImageToken(current.imageUrl, imageToken)} alt=""
              className="max-h-full max-w-full object-contain" />
          ) : (
            <p className="text-white/60 text-sm">{t('exemplarImages.compare.noPair')}</p>
          )}
        </div>
      </div>
    </div>
  );
};

export default ExemplarCompare;
