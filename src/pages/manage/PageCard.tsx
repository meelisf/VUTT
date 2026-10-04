import React from 'react';
import { useTranslation } from 'react-i18next';
import { Crop, Check, Loader2, FileCheck2, AlertCircle, Columns2, RotateCw } from 'lucide-react';
import PageThumb from './PageThumb';
import { IMAGE_BASE_URL } from '../../config';
import { useUser } from '../../contexts/UserContext';
import { ReocrState } from '../../utils/reocrStatus';
import { cardLineLeftPercent } from '../../components/pagePrep/geometry';
import { workPagePreviewUrl } from '../../services/workApi';
import { PendingPageOp, effectiveSplitX, needsServerPreview, showsCardLine } from './pageOpsPlan';

interface PageCardProps {
  workId: string;
  filename: string;
  imageName: string;
  visiblePageNum: number;
  status: string;
  hasText: boolean;
  reocrState?: ReocrState;
  isSelected: boolean;
  isChanged: boolean;
  thumbCacheBust: number;
  imageToken?: { exp: number; sig: string } | null;
  onToggle: (filename: string, shiftKey: boolean) => void;
  /** Avab pildiredaktori: 'edit' = kärbe/kalle/pööre, 'split' = poolitusjoon. */
  onEdit: (tab: 'edit' | 'split') => void;
  isFocused?: boolean;
  /** Ootel pööre/kärbe/poolitus (#431, ADR 0061) — kaart näitab eelvaadet, fail ei ole veel muutunud. */
  pendingOp?: PendingPageOp;
  /** Üldjoon (0..1) ootel poolitusele. */
  splitX: number;
}

/** Ootel pöörde eelvaade CSS-iga. 90°/270° juures skaleeritakse 3:4 kasti
 *  sisse (pööratud kast oleks 4:3 ja lõikuks servadest). */
const rotateStyle = (deg: number): React.CSSProperties | undefined => {
  if (!deg) return undefined;
  const scale = deg === 90 || deg === 270 ? ' scale(0.75)' : '';
  return { transform: `rotate(${deg}deg)${scale}` };
};

const statusColor = (status: string) => {
  switch (status) {
    case 'Valmis': return 'bg-green-100 text-green-700';
    case 'Kontrollitud': return 'bg-blue-100 text-blue-700';
    default: return 'bg-gray-100 text-gray-600';
  }
};

const PageCard = React.forwardRef<HTMLDivElement, PageCardProps>((p, ref) => {
  const { t } = useTranslation(['workspace', 'common']);
  const { authToken } = useUser();
  const imageTokenQuery = p.imageToken ? `&exp=${p.imageToken.exp}&sig=${p.imageToken.sig}` : '';
  const [aspect, setAspect] = React.useState<number | undefined>(undefined);
  const op = p.pendingOp;
  // 180° ei muuda kuvatud pildi mõõte → joon käib sama valemi järgi.
  const lineLeft = showsCardLine(op) ? cardLineLeftPercent(aspect, effectiveSplitX(op, p.splitX)) : null;
  // Kärbet/kallet CSS ei näita → server renderdab pisipildist eelvaate (pööre sees).
  const serverPreview = needsServerPreview(op);
  const thumbSrc = serverPreview
    ? workPagePreviewUrl(p.workId, p.filename, authToken, op!.rotate, op!.adjust ?? null, 'thumb', p.thumbCacheBust)
    : `${IMAGE_BASE_URL}/${p.workId}/_thumbs/_thumb_${p.imageName}?v=${p.thumbCacheBust}${imageTokenQuery}`;
  return (
    <div
      ref={ref}
      className={`relative flex flex-col rounded-lg border overflow-hidden bg-white ${
        p.isFocused ? 'ring-2 ring-blue-500 motion-safe:animate-pulse'
          : p.isSelected ? 'border-primary-500 ring-2 ring-primary-400'
          : p.isChanged || op ? 'border-amber-400 ring-1 ring-amber-300' : 'border-gray-200'
      }`}
    >
      {/* Kogu pisipildi-ala on valiku-sihtmärk: klõps valib, Shift+klõps vahemiku.
          select-none väldib Shift+klõpsu teksti-esiletõstu üle ruudustiku. */}
      <div
        className="relative aspect-[3/4] bg-gray-100 overflow-hidden cursor-pointer select-none"
        onClick={(e) => p.onToggle(p.filename, e.shiftKey)}
        title={t('manage.select.toggleHint')}
      >
        {/* Valiku-märkeruut — vasakus ülanurgas (eraldi klõpsatav, klaviatuuri jaoks) */}
        <button
          onClick={(e) => { e.stopPropagation(); p.onToggle(p.filename, e.shiftKey); }}
          className={`absolute top-1 left-1 z-10 w-5 h-5 flex items-center justify-center rounded border shadow-sm ${
            p.isSelected ? 'bg-primary-600 border-primary-600 text-white' : 'bg-white/90 border-gray-600 text-transparent'
          }`}
          title={t('manage.select.toggleHint')}
          aria-pressed={p.isSelected}
        >
          <Check size={13} />
        </button>
        {/* Tekstita märk — üleval paremal (eraldi reocr-märgist) */}
        {!p.hasText && !p.reocrState && (
          <span
            className="absolute top-1 right-1 z-10 px-1 py-0.5 rounded text-[10px] leading-none bg-amber-100 text-amber-700 border border-amber-300 shadow-sm"
            title={t('manage.reocr.badge.noText')}
          >
            {t('manage.reocr.badge.noText')}
          </span>
        )}
        {/* Re-OCR olek — üleval paremal, märgib sõltumatult has_text-st.
            "ocr_ready" tähendab "OCR valmis ülevaatamiseks", MITTE "leht korras". */}
        {p.reocrState === 'processing' && (
          <span className="absolute top-1 right-1 z-10 p-1 rounded bg-white/90 border border-gray-300 shadow-sm"
            title={t('manage.reocr.badge.processing')}>
            <Loader2 size={12} className="animate-spin text-gray-600" />
          </span>
        )}
        {p.reocrState === 'ocr_ready' && (
          <span className="absolute top-1 right-1 z-10 flex items-center gap-0.5 px-1 py-0.5 rounded text-[10px] leading-none bg-green-100 text-green-700 border border-green-300 shadow-sm"
            title={t('manage.reocr.badge.ready')}>
            <FileCheck2 size={11} /> {t('manage.reocr.badge.ready')}
          </span>
        )}
        {p.reocrState === 'error' && (
          <span className="absolute top-1 right-1 z-10 p-1 rounded bg-red-100 border border-red-300 shadow-sm"
            title={t('manage.reocr.badge.error')}>
            <AlertCircle size={12} className="text-red-600" />
          </span>
        )}
        <PageThumb
          workId={p.workId}
          src={thumbSrc}
          /* `object-contain`, MITTE `cover` (sama kuju nagu upload'i kontaktlehel
             ja UploadStepReview'l): rõhtne leht ON lapiti ja peab ka ruudustikus
             lapiti välja nägema. `cover` lõikas küljed 3/4 portreeks ja peitis
             just selle — lehe tegelikku formaati polnud kaardilt näha. */
          className="w-full h-full object-contain"
          onAspect={setAspect}
          imgStyle={serverPreview ? undefined : rotateStyle(op?.rotate ?? 0)}
        />
        {/* Ootel poolituse joon — sama värv ja kuju nagu upload'i kontaktlehel. */}
        {lineLeft !== null && (
          <div
            data-testid="pending-split-line"
            className="absolute top-0 bottom-0 w-px bg-rose-600 pointer-events-none"
            style={{ left: `${lineLeft}%` }}
          />
        )}
        {/* Ootel toimingute märk — all keskel, et nurgad jääksid vabaks. */}
        {op && (
          <span
            data-testid="pending-op-badge"
            className="absolute bottom-1 left-1/2 -translate-x-1/2 z-10 flex items-center gap-1 px-1 py-0.5 rounded text-[10px] leading-none bg-amber-100 text-amber-800 border border-amber-300 shadow-sm"
          >
            {op.rotate !== 0 && (<><RotateCw size={11} />{op.rotate}°</>)}
            {op.adjust && (<><Crop size={11} />{t('manage.pageOps.badgeCrop')}</>)}
            {op.split && (<><Columns2 size={11} />{t('manage.pageOps.badgeSplit')}</>)}
          </span>
        )}
        {/* Nähtav number — all vasakul */}
        <span className={`absolute bottom-1 left-1 text-xs px-1 py-0.5 rounded leading-tight shadow-sm ${statusColor(p.status)}`}>
          {p.visiblePageNum}
        </span>
        {/* Redaktor — all paremal: kaks eraldi nuppu, et kärpimine oleks leitav
            (varem üks käärid-ikoon, mida loeti poolitamiseks, ADR 0061). */}
        <div className="absolute bottom-1 right-1 flex gap-1">
          <button
            data-testid="card-open-crop"
            onClick={(e) => { e.stopPropagation(); p.onEdit('edit'); }}
            className="p-1 bg-white/90 border border-gray-600 hover:bg-gray-100 text-gray-600 hover:text-gray-800 rounded shadow-sm transition-colors"
            title={t('manage.editor.openCrop')}
            aria-label={t('manage.editor.openCrop')}
          >
            <Crop size={14} />
          </button>
          <button
            data-testid="card-open-split"
            onClick={(e) => { e.stopPropagation(); p.onEdit('split'); }}
            className="p-1 bg-white/90 border border-gray-600 hover:bg-gray-100 text-gray-600 hover:text-gray-800 rounded shadow-sm transition-colors"
            title={t('manage.editor.openSplit')}
            aria-label={t('manage.editor.openSplit')}
          >
            <Columns2 size={14} />
          </button>
        </div>
      </div>
    </div>
  );
});

PageCard.displayName = 'PageCard';

export default React.memo(PageCard);
