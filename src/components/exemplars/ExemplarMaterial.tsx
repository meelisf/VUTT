/**
 * Eksemplari lehe kaart „pildimaterjal" (spets „Pildimaterjal: üks reegel"):
 * valitud võtme teose lehed (ainult vaatamiseks) ja eksemplari oma pildid samas
 * kaardis. Kaks alapealkirja ainult siis, kui mõlemad osad on olemas.
 * Tühi jaotis on adminile üks rida; avalikule lugejale tühja kaarti ei näidata.
 */
import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { Columns2 } from 'lucide-react';
import ExemplarImageEditor from './ExemplarImageEditor';
import AdaImportDialog from './AdaImportDialog';
import type { ExemplarManifest } from '../../services/exemplarImagesService';
import type { WorkExemplarsResponse } from '../../services/workApi';
import { withImageToken, type ImageToken } from '../../utils/imageTokenUrl';
import { PAGES_KEY, materialParts, type SeqItem, type Sequence } from './exemplarSequences';

interface ExemplarMaterialProps {
  workId: string;
  selected: string;
  data: WorkExemplarsResponse;
  /** Valitud eksemplari manifest (null = laeb / pole). */
  manifest: ExemplarManifest | null;
  canEdit: boolean;
  canCompare: boolean;
  imageToken: ImageToken | null;
  authToken: string | null;
  /** Suur pilt: jada võti (PAGES_KEY | eksemplari id) ja indeks. */
  onOpen: (seqKey: string, index: number) => void;
  onCompare: (seqKey: string, index: number) => void;
  onManifest: (m: ExemplarManifest) => void;
  onImported: () => void;
}

/** Pikk võrk on vaikimisi piiratud — mitmesaja lehega käsikirjal on ainus eksemplar ühtlasi alus. */
const VISIBLE_LIMIT = 24;
const MIN_COLS = 3;
const MAX_COLS = 8;
const DEFAULT_COLS = 6;

const ExemplarMaterial: React.FC<ExemplarMaterialProps> = ({
  workId, selected, data, manifest, canEdit, canCompare, imageToken, authToken,
  onOpen, onCompare, onManifest, onImported,
}) => {
  const { t } = useTranslation(['workspace', 'common']);
  const [cols, setCols] = useState(DEFAULT_COLS);
  const [showAll, setShowAll] = useState<Record<string, boolean>>({});
  const [editing, setEditing] = useState(false);
  const [adaOpen, setAdaOpen] = useState(false);

  const { pages, images } = materialParts(workId, data, selected, manifest?.images ?? null);
  const isExemplar = selected !== PAGES_KEY;
  const hasPages = pages.items.length > 0;
  const hasImages = (images?.items.length ?? 0) > 0;
  const both = hasPages && hasImages;
  const sign = (url: string) => withImageToken(url, imageToken);

  // Avalikule lugejale tühja kaarti ei ole; adminile on pildita eksemplaril üks rida.
  if (!hasPages && !hasImages && !(canEdit && isExemplar)) return null;

  const grid = (seq: Sequence) => {
    const all = showAll[seq.key] || seq.items.length <= VISIBLE_LIMIT;
    const shown = all ? seq.items : seq.items.slice(0, VISIBLE_LIMIT);
    return (
      <>
        <div className="grid gap-2.5" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>
          {shown.map((it, i) => thumb(seq, it, i))}
        </div>
        {!all && (
          <button type="button" onClick={() => setShowAll(s => ({ ...s, [seq.key]: true }))}
            className="mt-2 text-xs text-primary-700 hover:text-primary-900">
            {t('exemplarPage.more', { count: seq.items.length - VISIBLE_LIMIT })} · {t('exemplarPage.showAll')}
          </button>
        )}
      </>
    );
  };

  const thumb = (seq: Sequence, it: SeqItem, i: number) => {
    const pairN = it.pairStem ? data.page_numbers[it.pairStem] : undefined;
    return (
      <button key={it.key} type="button" data-testid="material-thumb" onClick={() => onOpen(seq.key, i)}
        className="group text-left border border-gray-200 rounded-lg overflow-hidden bg-white hover:border-primary-300">
        <img src={sign(it.thumb)} alt="" loading="lazy" className="block w-full aspect-[3/4] object-cover bg-gray-100" />
        <span className="flex items-center gap-1 px-1.5 py-0.5 text-[11px] text-gray-700 border-t border-gray-100">
          <span className="truncate">{seq.kind === 'pages' ? t('exemplarPage.pageLabel', { n: it.label }) : it.label}</span>
          {pairN !== undefined && (
            <span data-testid="pair-badge" className="ml-auto shrink-0 text-primary-700">
              ⇄ {t('exemplarPage.pageLabel', { n: pairN })}
            </span>
          )}
        </span>
      </button>
    );
  };

  const btn = 'text-xs px-2 py-1 rounded border border-gray-300 bg-white text-gray-700 hover:bg-gray-50';

  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm" data-testid="exemplar-material">
      {(hasPages || hasImages) && (
        <div className="flex flex-wrap items-center gap-2 px-4 sm:px-5 pt-3 text-sm text-gray-600">
          <button type="button" onClick={() => setCols(c => Math.min(c + 1, MAX_COLS))} disabled={cols >= MAX_COLS}
            className="px-2 py-0.5 border rounded disabled:opacity-40" title={t('thumbnails.smaller')}>−</button>
          <input type="range" min={MIN_COLS} max={MAX_COLS} value={MAX_COLS + MIN_COLS - cols}
            onChange={e => setCols(MAX_COLS + MIN_COLS - Number(e.target.value))} aria-label={t('thumbnails.columns')} />
          <button type="button" onClick={() => setCols(c => Math.max(c - 1, MIN_COLS))} disabled={cols <= MIN_COLS}
            className="px-2 py-0.5 border rounded disabled:opacity-40" title={t('thumbnails.larger')}>+</button>
          {canCompare && (
            <button type="button" onClick={() => onCompare(hasImages ? images!.key : pages.key, 0)}
              className={`ml-auto ${btn} inline-flex items-center gap-1`}>
              <Columns2 size={13} />{t('exemplarPage.compare')}
            </button>
          )}
        </div>
      )}

      {hasPages && (
        <section className="px-4 sm:px-5 py-3">
          <div className="flex flex-wrap items-center gap-2 mb-2">
            {both && <h3 className="text-sm font-semibold text-gray-800">{t('exemplarPage.ownPages')}</h3>}
            <span className="text-xs text-gray-500">{t('exemplarPage.viewOnly')}</span>
            {canEdit && (
              <Link to={`/work/${workId}/manage`} className="ml-auto text-xs text-primary-700 hover:text-primary-900">
                {t('exemplarPage.managePages')}
              </Link>
            )}
          </div>
          {grid(pages)}
        </section>
      )}

      {isExemplar && (hasImages || canEdit) && (
        <section className={`px-4 sm:px-5 py-3 ${hasPages ? 'border-t border-gray-100' : ''}`}>
          <div className="flex flex-wrap items-center gap-2 mb-2">
            {both && <h3 className="text-sm font-semibold text-gray-800">{t('exemplarPage.ownImages')}</h3>}
            {!hasImages && manifest && <span className="text-sm text-gray-500">{t('exemplarPage.noImages')}</span>}
            {canEdit && manifest && (
              <span className="ml-auto flex flex-wrap gap-2">
                <button type="button" className={btn} onClick={() => setEditing(true)}>{t('exemplarImages.editor.upload')}</button>
                <button type="button" className={btn} onClick={() => setAdaOpen(true)}>{t('exemplarPage.adaImport')}</button>
                {hasImages && (
                  <button type="button" className={btn} aria-pressed={editing} onClick={() => setEditing(e => !e)}>
                    {t('exemplarPage.editImages')}
                  </button>
                )}
              </span>
            )}
          </div>
          {hasImages && grid(images!)}
          {editing && canEdit && manifest && (
            <div className="mt-3">
              <ExemplarImageEditor workId={workId} exemplarId={selected} manifest={manifest}
                authToken={authToken} onManifest={onManifest} />
            </div>
          )}
        </section>
      )}

      {adaOpen && (
        <AdaImportDialog workId={workId} exemplarId={selected} authToken={authToken}
          onPublished={() => { setAdaOpen(false); onImported(); }} onClose={() => setAdaOpen(false)} />
      )}
    </div>
  );
};

export default ExemplarMaterial;
