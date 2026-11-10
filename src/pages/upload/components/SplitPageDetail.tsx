// ⚠ KAKS PILDIREDAKTORIT: see ja components/PageImageEditorModal.tsx peavad välja nägema ja käituma ühtmoodi.
// Ühine osa on `components/pagePrep/`; muudatus ühes vaates tähendab, et kontrolli ka teist
// (vt CLAUDE.md „Kaks pildiredaktorit“).
import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { ImageToken } from '../../../utils/imageTokenUrl';
import { useTranslation } from 'react-i18next';
import { X, ChevronRight, Check, Columns2, Eye, EyeOff } from 'lucide-react';
import { prepressPreviewUrl } from '../uploadApi';
import { adjustFromParams, willSplit, withRotation } from '../prepressPlan';
import { addRotation, clampSplitX } from '../../../components/pagePrep/geometry';
import { useSplitDrag } from '../../../components/pagePrep/useSplitDrag';
import SplitLine from '../../../components/pagePrep/SplitLine';
import { useCropBox } from '../../../components/pagePrep/useCropBox';
import CropOverlay from '../../../components/pagePrep/CropOverlay';
import EditToolbar from '../../../components/pagePrep/EditToolbar';
import EditorTabs, { type EditorTab } from '../../../components/pagePrep/EditorTabs';
import PageNavFooter from '../../../components/pagePrep/PageNavFooter';
import PendingGroup from '../../../components/pagePrep/PendingGroup';
import PendingOutline from '../../../components/pagePrep/PendingOutline';
import type { PrepressPage, PrepressPlan } from '../types';

interface Props {
  uploadId: string;
  ticket: ImageToken | null;
  plan: PrepressPlan;
  pageNum: number;
  onPageChange: (n: number, patch: Partial<PrepressPage>) => void;
  onNavigate: (n: number) => void;
  onClose: () => void;
}

/**
 * Teine tase: üks leht suurelt, lohistatava joonega.
 *
 * Natiivse lahutusega köitevahe-riba oli siin varem kõrval-paanina ja
 * eemaldati: 100 DPI eelvaade näitab joone asukoha juba piisava täpsusega,
 * riba aga tõi kaasa oma endpointi, x-kvantimise ja ketta-vahemälu.
 *
 * Joon, käepide, lohistus, pööramisnupud ja kärpekast tulevad
 * `components/pagePrep`-ist — samad osad kasutab Manage-lehe
 * `PageImageEditorModal` (#431).
 *
 * Kuju on sama mis teose halduse `PageImageEditorModal`-il: päises vahekaardid
 * „Pööra ja kärbi" / „Poolita", ootel olek kollases kapslis, jaluses „Tagasi
 * ülevaatesse" + ‹ ›. ⚠ KAKS REDAKTORIT: muudad ühte → kontrolli ka teist
 * (CLAUDE.md „Kaks pildiredaktorit"); ühine kest on `components/pagePrep/`.
 *
 * „Pööra ja kärbi" näitab KOHANDAMATA (ainult pööratud) eelvaadet ja „Märgi"
 * kirjutab plaani `adjust` välja; „Poolita" näitab kohandatud eelvaadet, seega
 * poolitusjoon asetub täpselt nagu apply lõikab (pööre → adjust → poolitus).
 */
const SplitPageDetail: React.FC<Props> = ({
  uploadId, ticket, plan, pageNum, onPageChange, onNavigate, onClose,
}) => {
  const { t } = useTranslation(['upload', 'common']);
  const page = plan.pages.find((p) => p.n === pageNum);
  const liveX = page?.mode === 'custom' && page.split_x != null
    ? page.split_x
    : plan.default_split_x;

  const boxRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);

  /**
   * Pildi TEGELIK kast letterbox-ala sees (px, `boxRef` suhtes).
   *
   * Modaal on fikseeritud kõrgusega ja pilt mahutatakse `object-contain`-iga —
   * seega jääb pildi kõrvale (portree) või alla-peale (lapiti) tühja ala.
   * Joon, käepide ja klõps EI TOHI käia konteineri järgi: `x` on osa PILDI
   * laiusest. Mõõdame elemendi enda kasti, mitte ei arvuta kuvasuhtest —
   * `max-h-full max-w-full` korral ON img-elemendi kast juba renderdatud kast.
   */
  const [imgBox, setImgBox] = useState({ left: 0, top: 0, width: 0, height: 0 });

  // Vahekaart püsib lehtede vahel liikudes (nagu teose halduses): sama suure kastiga
  // (kleepuv suurus) saab järjest lehti läbi käia. Upload'i põhitöö on poolitus.
  const [tab, setTab] = useState<EditorTab>('split');
  const editTab = tab === 'edit';
  const crop = useCropBox(imgBox.width, imgBox.height, editTab && imgBox.width > 0);
  const resetCrop = crop.reset;
  // Ootel kärbega lehele ei panda kleepuvat kasti: see peidaks ootel kärbe kontuuri
  // (sama reegel nagu halduse redaktoris).
  const hasAdjustRef = useRef(false);
  hasAdjustRef.current = Boolean(page?.adjust);
  // page?.rotate: pööre muudab kärpe raami → kast lähtestatakse.
  useEffect(() => { resetCrop(!hasAdjustRef.current); }, [pageNum, tab, page?.rotate, resetCrop]);

  // Kas seda lehte päriselt poolitatakse. Joon ja käepide EI TOHI olla nähtaval,
  // kui vastus on ei — muidu näitab vaade tegevust, mida ei toimu.
  const splits = page ? willSplit(plan, pageNum) : false;
  const excluded = Boolean(page?.excluded);
  // Väljajäetud lehel EI ole poolitusnupp keelatud: `excluded` ja `mode` on
  // risti (ADR 0026) — poolitusolek säilib ja hakkab kehtima, kui leht OCR-i
  // tagasi lisada. Nupp on ainult tuhmim + vihjega, sest praegu ta ei tee midagi.
  const noSplitMode = page?.mode === 'nosplit';

  const index = plan.pages.findIndex((p) => p.n === pageNum);
  const hasPrev = index > 0;
  const hasNext = index >= 0 && index < plan.pages.length - 1;

  const goTo = useCallback((i: number) => {
    const target = plan.pages[i];
    if (target) onNavigate(target.n);
  }, [plan.pages, onNavigate]);

  // Vahekaardi vahetus: märkimata kast läheb enne plaani (muidu näitaks poolitusvaade
  // pilti, kus kärpet ei ole) — sama käitumine nagu halduse redaktoris.
  const switchTab = (next: EditorTab) => {
    if (tab === 'edit' && next === 'split' && crop.hasEdit) {
      onPageChange(pageNum, { adjust: adjustFromParams(crop.toServerParams(0)) });
    }
    setTab(next);
  };

  // „Märgi ja järgmine": kast läheb plaani JA vaade liigub edasi; kastita leht = „Järgmine".
  const markPending = () => {
    if (crop.hasEdit) onPageChange(pageNum, { adjust: adjustFromParams(crop.toServerParams(0)) });
    if (hasNext) goTo(index + 1);
    else { crop.clearCrop(); }
  };

  // Pööre on KOGUV: kaks klõpsu paremale = 180°. Pööre rakendub enne poolitamist,
  // seega joon liigub pööratud pildiga kaasa. withRotation eemaldab kärpe: see on
  // eelmise pöörde raamis.
  const rotateBy = (delta: number) => {
    if (!page) return;
    const next = withRotation(page, addRotation(page.rotate ?? 0, delta));
    onPageChange(pageNum, { rotate: next.rotate, adjust: next.adjust });
  };

  const setX = (x: number) =>
    onPageChange(pageNum, { mode: 'custom', split_x: clampSplitX(Number(x.toFixed(4))) });

  const { startDrag, updateFromClientX } = useSplitDrag(imgRef, setX);

  // Pildi kasti mõõtmine: laadimisel, akna muutusel ja lehe vahetusel.
  // ResizeObserver katab ka modaali sisemised nihked (nupurea murdumine).
  const measure = useCallback(() => {
    const box = boxRef.current;
    const img = imgRef.current;
    if (!box || !img) return;
    const b = box.getBoundingClientRect();
    const i = img.getBoundingClientRect();
    const next = {
      left: i.left - b.left, top: i.top - b.top, width: i.width, height: i.height,
    };
    setImgBox((prev) => (prev.left === next.left && prev.top === next.top
      && prev.width === next.width && prev.height === next.height ? prev : next));
  }, []);

  useLayoutEffect(() => {
    measure();
    const ro = new ResizeObserver(measure);
    if (boxRef.current) ro.observe(boxRef.current);
    if (imgRef.current) ro.observe(imgRef.current);
    window.addEventListener('resize', measure);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, [measure, pageNum]);

  // Klaviatuur: nooled vahetavad LEHTE (mitte joont), Escape sulgeb.
  // Sama leping nagu Manage-lehe pildiredaktoris — ära kaaperda nooli,
  // kui fookus on sisestusväljal.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (document.activeElement?.tagName || '').toUpperCase();
      const role = (document.activeElement as HTMLElement | null)?.getAttribute('role');
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(tag) || role === 'slider') return;
      if (e.key === 'ArrowLeft') goTo(index - 1);
      else if (e.key === 'ArrowRight') goTo(index + 1);
      else if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [goTo, index, onClose]);

  if (!page) return null;

  return (
    // z-[1300]: Header on `sticky z-[1200]` ja kataks muidu modaali ülemise
    // serva — just seal, kus on sulgemisnupp. Sama väärtus nagu
    // PageImageEditorModal'is; tegevusribad on `z-[1100]` ehk päise all.
    <div className="fixed inset-0 z-[1300] flex items-center justify-center overflow-hidden bg-black/70 p-2 sm:p-4">
      {/* Kõrgus on FIKSEERITUD (`h-`, mitte `max-h-`) ja pilt mahutatakse
          järelejäänud kasti. Varem kasvas modaal sisu järgi: lapiti leht andis
          madala akna, portree kõrge — nupurida hüppas iga lehe peale uude
          kohta ja portree alumine serv jäi kerimise taha. Ülevaatus on
          tsükliline töö („vaata → otsusta → järgmine"), seega peavad päis ja
          nupurida seisma paigal ja leht olema ALATI tervikuna näha.
          flex-col: päis ja jalus on omaette flex-lapsed ega keri kaasa. */}
      <div className="flex h-[calc(100vh-1rem)] w-full max-w-6xl flex-col rounded bg-white sm:h-[calc(100vh-2rem)]">
        {/* Päis: sama kuju kui teose halduse pildiredaktoris — leht, vahekaardid, mis selle
            lehega ootel on; paremal harv toiming ja sulgemine. */}
        <div className="flex flex-shrink-0 flex-wrap items-center gap-x-3 gap-y-2 rounded-t border-b border-gray-200 bg-white px-4 py-2.5">
          <h3 className="whitespace-nowrap font-semibold text-gray-900">
            {t('common:pagePrep.page', { cur: index + 1, total: plan.pages.length })}
          </h3>
          <EditorTabs tab={tab} onChange={switchTab} />
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
            <PendingGroup
              rotate={page.rotate ?? 0} adjust={page.adjust ?? null}
              splitPercent={splits ? Math.round(liveX * 1000) / 10 : null}
              onAdjustClear={() => onPageChange(pageNum, { adjust: null })} testIdPrefix="detail" />
            {tab === 'split' && !splits && !excluded && (
              <span data-testid="detail-split-state" className="text-xs text-gray-500">{t('common:pagePrep.notSplit')}</span>
            )}
            {excluded && (
              <span data-testid="detail-excluded-state" className="text-xs font-medium text-gray-700">
                {t('step3split.isExcluded')}
              </span>
            )}
          </div>
          {/* Väljajätmine on upload'i oma toiming (halduses seda pole) ja käib mõlemal
              vahekaardil: otsus „see leht ei tule teosesse" ei sõltu vaatest. */}
          <button
            type="button"
            data-testid="detail-exclude"
            aria-pressed={excluded}
            className={`flex items-center gap-1.5 rounded border px-2.5 py-1.5 text-sm ${
              excluded ? 'border-gray-900 bg-gray-900 font-medium text-white' : 'border-gray-300 text-gray-700 hover:bg-gray-100'
            }`}
            onClick={() => onPageChange(pageNum, { excluded: !excluded })}
          >
            {excluded ? <EyeOff size={15} /> : <Eye size={15} />}
            {excluded ? t('step3split.card.include') : t('step3split.card.exclude')}
          </button>
          <button
            type="button"
            onClick={onClose}
            aria-label={t('common:buttons.close')}
            className="-mr-1 rounded p-2 text-gray-500 hover:bg-gray-100 hover:text-gray-900"
          >
            <X size={18} />
          </button>
        </div>

        {/* overflow-hidden, MITTE auto: pilt mahutatakse, mitte ei keritata. */}
        <div className="flex min-h-0 flex-1 flex-row gap-3 overflow-hidden p-4">
          {/* Kärpimisrežiimis vasak tööriistaveerg (ühine halduse redaktoriga);
              muidu hoiab tühi koht riba laiust, et pilt režiimi vahetades ei nihkuks. */}
          {editTab
            ? <EditToolbar crop={crop} onRotate={rotateBy} testIdPrefix="detail" />
            : <div aria-hidden="true" className="w-14 flex-shrink-0" />}
          <div
            ref={boxRef}
            className={`relative flex h-full min-w-0 flex-1 select-none touch-none items-center justify-center ${splits && !editTab ? 'cursor-col-resize' : ''}`}
            onPointerDown={(e) => { if (splits && !editTab) updateFromClientX(e.clientX); }}
          >
            <img
              ref={imgRef}
              src={prepressPreviewUrl(
                uploadId, pageNum, ticket, page?.rotate ?? 0,
                editTab ? null : page?.adjust ?? null,
              ) || undefined}
              alt={`${pageNum}`}
              onLoad={measure}
              className="block max-h-full max-w-full object-contain"
              draggable={false}
            />
            {/* Joon + käepide: nähtaval AINULT siis, kui leht päriselt
                poolitatakse, ja paigutatud PILDI kasti järgi (vt imgBox). */}
            {editTab && imgBox.width > 0 && (
              <div
                data-testid="detail-crop-area"
                className="absolute"
                style={{
                  left: imgBox.left, top: imgBox.top,
                  width: imgBox.width, height: imgBox.height,
                }}
              >
                {!crop.hasEdit && (
                  <PendingOutline adjust={page.adjust} width={imgBox.width} height={imgBox.height}
                    testId="detail-pending-outline" />
                )}
                <CropOverlay crop={crop} deskewTitle={t('common:pagePrep.deskew')} />
              </div>
            )}

            {tab === 'split' && splits && imgBox.width > 0 && (
              <SplitLine
                x={liveX}
                box={imgBox}
                onHandleDown={startDrag}
                lineTestId="detail-line"
                handleTestId="detail-handle"
              />
            )}

            {tab === 'split' && !splits && imgBox.width > 0 && (
              <div
                data-testid="detail-nosplit-badge"
                className="pointer-events-none absolute flex flex-col items-center justify-start gap-1 bg-white/40 pt-6"
                style={{
                  left: imgBox.left, top: imgBox.top,
                  width: imgBox.width, height: imgBox.height,
                }}
              >
                <span className="flex items-center gap-2 rounded-full bg-gray-900/85 px-4 py-2 text-sm font-medium text-white shadow-lg">
                  {excluded ? <EyeOff size={15} /> : <Columns2 size={15} />}
                  {excluded ? t('step3split.isExcluded') : t('step3split.willNotSplit')}
                </span>
                {/* Ilma tagajärjeta jäi õhku, MIS väljajäetud lehest saab:
                    ta ei jõua OCR-i ega teosesse, seega ka poolitamine ei
                    puutu teda. Poolitusolek ise jääb plaani alles. */}
                {excluded && (
                  <span
                    data-testid="detail-excluded-explain"
                    className="max-w-[22rem] rounded bg-gray-900/70 px-3 py-1 text-center text-xs text-white shadow"
                  >
                    {t('step3split.excludedExplain')}
                  </span>
                )}
              </div>
            )}
          </div>
        </div>

        <div className="flex-shrink-0 space-y-2 rounded-b border-t border-gray-200 bg-white px-4 py-3">
          {/* Jalus järgib halduse redaktorit: Ülevaatesse | ‹ › | vahekaardi toimingud;
              paremal peamine nupp (kärpimisel „Märgi ja järgmine"). Värvi leping:
              must = seda lehte EI poolitata / EI OCR-ita; aria-pressed käib värviga kaasas. */}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-1">
              <PageNavFooter onBack={onClose} onPrev={() => goTo(index - 1)} onNext={() => goTo(index + 1)}
                hasPrev={hasPrev} hasNext={hasNext} />
              {tab === 'split' && (
                <div className="ml-2 flex flex-wrap items-center gap-2 border-l border-gray-200 pl-3">
                  <button
                    type="button"
                    data-testid="detail-nosplit"
                    aria-pressed={noSplitMode}
                    title={excluded ? t('step3split.card.splitKeptWhileExcluded') : undefined}
                    className={`flex items-center gap-1.5 rounded border px-3 py-1.5 text-sm ${
                      noSplitMode ? 'border-gray-900 bg-gray-900 font-medium text-white' : 'border-gray-300 hover:bg-gray-100'
                    } ${excluded ? 'opacity-50' : ''}`}
                    onClick={() => onPageChange(pageNum, { mode: noSplitMode ? 'default' : 'nosplit', split_x: null })}
                  >
                    <Columns2 size={15} />
                    {noSplitMode ? t('step3split.card.split') : t('step3split.card.noSplit')}
                  </button>
                  {page.mode === 'custom' && (
                    <button
                      type="button"
                      data-testid="detail-reset-split"
                      className="rounded border border-gray-300 px-3 py-1.5 text-sm hover:bg-gray-100"
                      onClick={() => onPageChange(pageNum, { mode: 'default', split_x: null })}
                    >
                      {t('common:pagePrep.resetToGlobal')}
                    </button>
                  )}
                </div>
              )}
            </div>

            {tab === 'edit' && (
              <button
                type="button"
                data-testid="detail-mark"
                onClick={markPending}
                disabled={!crop.hasEdit && !hasNext}
                className="flex items-center gap-2 rounded bg-indigo-600 px-5 py-2 text-sm text-white transition-colors hover:bg-indigo-700 disabled:opacity-50"
              >
                {!crop.hasEdit
                  ? t('common:pagePrep.next')
                  : !hasNext ? <><Check size={14} />{t('common:pagePrep.markPending')}</> : t('common:pagePrep.markAndNext')}
                {hasNext && <ChevronRight size={14} />}
              </button>
            )}
          </div>
          <p className="text-xs text-gray-500">
            {tab === 'split'
              ? t('step3split.detail.splitHint')
              : <>
                {crop.perspective ? t('common:pagePrep.perspectiveHint') : t('common:pagePrep.cropHint')}
                {' '}{t('step3split.detail.editHint')}
              </>}
          </p>
        </div>
      </div>
    </div>
  );
};

export default SplitPageDetail;
