// ⚠ KAKS PILDIREDAKTORIT: see ja components/PageImageEditorModal.tsx peavad välja nägema ja käituma ühtmoodi.
// Ühine osa on `components/pagePrep/`; muudatus ühes vaates tähendab, et kontrolli ka teist
// (vt CLAUDE.md „Kaks pildiredaktorit“).
import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { ImageToken } from '../../../utils/imageTokenUrl';
import { useTranslation } from 'react-i18next';
import { X, ChevronRight, Check, Eye, EyeOff } from 'lucide-react';
import { SplitIcon, UndoIcon } from '../../../components/icons';
import type { PageAdjust } from '../types';
import { prepressPreviewUrl } from '../uploadApi';
import { adjustFromParams, isPreviewReady, willSplit, withRotation } from '../prepressPlan';
import { addRotation } from '../../../components/pagePrep/geometry';
import SplitGuide, { useSplitGuideDrag } from '../../../components/pagePrep/SplitGuide';
import { outputQuad, splitSegment, splitXFromPoint, type Pt } from '../../../components/pagePrep/splitGeometry';
import { useCropBox } from '../../../components/pagePrep/useCropBox';
import CropOverlay from '../../../components/pagePrep/CropOverlay';
import CroppedPreviewMark from '../../../components/pagePrep/CroppedPreviewMark';
import EditToolbar from '../../../components/pagePrep/EditToolbar';
import { BackToOverview, PageNav } from '../../../components/pagePrep/PageNavFooter';
import PendingGroup from '../../../components/pagePrep/PendingGroup';
import PendingOutline from '../../../components/pagePrep/PendingOutline';
import { usePendingCrop } from '../../../components/pagePrep/usePendingCrop';
import PageFilmstrip, { type FilmstripItem } from '../../../components/pagePrep/PageFilmstrip';
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
 * Kuju on sama mis teose halduse `PageImageEditorModal`-il: üks vaade (ADR 0085),
 * ootel olek kollases kapslis, jaluses „Tagasi ülevaatesse" + ‹ ›. ⚠ KAKS REDAKTORIT: muudad ühte → kontrolli ka teist
 * (CLAUDE.md „Kaks pildiredaktorit"); ühine kest on `components/pagePrep/`.
 *
 * Vaade näitab KOHANDAMATA (ainult pööratud) eelvaadet: kärpekast ja poolitusjoon
 * on samal pildil, joon kärpe raamis (`splitGeometry`, pööre → adjust → poolitus).
 * „Näita tulemust" näitab serveri eelvaadet koos kärpega, ainult vaatamiseks.
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

  // „Näita tulemust" (ADR 0085): serveri eelvaade kärpega, ainult vaatamiseks.
  const [showResult, setShowResult] = useState(false);
  // Klõps ilma liikumiseta = poolitusjoon (ADR 0085); käsitleja allpool (vajab joone raami).
  const clickRef = useRef<(p: Pt) => void>(() => {});
  // Mõõdetud pildikast kuulub SELLELE lehele + pöördele (lehe vahetuse renderdusel on
  // olekus veel eelmise pildi kast) — ootel kärbe taastatakse alles siis (usePendingCrop).
  const pageKey = `${pageNum}:${page?.rotate ?? 0}`;
  const [loadedKey, setLoadedKey] = useState<string | null>(null);
  const imgReady = loadedKey === pageKey && !showResult && imgBox.width > 0;
  const crop = useCropBox(imgBox.width, imgBox.height, !showResult && imgBox.width > 0,
    { onClick: (p) => clickRef.current(p) });
  const resetCrop = crop.reset;
  // Ootel kärbega lehele ei panda kleepuvat pakkumist: kärbe taastatakse kastina.
  const hasAdjustRef = useRef(false);
  hasAdjustRef.current = Boolean(page?.adjust);
  // page?.rotate: pööre muudab kärpe raami → kast lähtestatakse.
  useEffect(() => { resetCrop(!hasAdjustRef.current); }, [pageNum, page?.rotate, resetCrop]);
  // Lehe vahetus lülitab tulemuse eelvaate välja.
  useEffect(() => { setShowResult(false); }, [pageNum]);

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

  // Pisipiltide riba: sama eelvaade (pööre + kärbe sees) ja sama joon mis kontaktlehel.
  // Ootel = kasutaja on lehele midagi märkinud (vaikimisi ei poolitata midagi).
  const filmstripItems = useMemo<FilmstripItem[]>(() => plan.pages.map((p) => {
    const split = willSplit(plan, p.n);
    const rotate = Boolean(p.rotate);
    const crop = Boolean(p.adjust);
    return {
      key: String(p.n),
      src: isPreviewReady(plan, p.n)
        ? prepressPreviewUrl(uploadId, p.n, ticket, p.rotate ?? 0, p.adjust ?? null)
        : '',
      splitX: split
        ? (p.mode === 'custom' && p.split_x != null ? p.split_x : plan.default_split_x)
        : null,
      pending: rotate || crop || split ? { rotate, crop, split } : null,
      excluded: Boolean(p.excluded),
    };
  }), [plan, uploadId, ticket]);

  // --- Kõik on kohe ootel (ADR 0085) ---
  // Ekraanil olev kast = ootel kärbe: taastatakse lehele tulles ja iga muudatus läheb kohe
  // plaani. Kleepuv kast on pakkumine — plaani alles puudutamisel või põhinupu peale.
  usePendingCrop({
    crop, pendingAdjust: page?.adjust ?? null, pageKey, ready: imgReady,
    onCommit: (adjust) => onPageChange(pageNum, { adjust }),
  });
  // Joone raam = plaani kärbe. Lohistuse ajal järgib joon kasti juba enne kirjutust.
  const boxAdjust = (): PageAdjust | null => adjustFromParams(crop.toServerParams(0));
  const visibleAdjust: PageAdjust | null = crop.userEdited ? boxAdjust() : page?.adjust ?? null;
  const splitQuad = outputQuad(visibleAdjust, imgBox.width, imgBox.height);

  // Põhinupp: pakkumise korral „Kärbi ja järgmine" (võtab kasti vastu), muidu „Järgmine".
  const advance = () => {
    if (crop.proposal) {
      onPageChange(pageNum, { adjust: boxAdjust() });
      crop.acceptProposal();
    }
    if (hasNext) goTo(index + 1);
  };

  // Pööre on KOGUV: kaks klõpsu paremale = 180°. Pööre rakendub enne poolitamist,
  // seega joon liigub pööratud pildiga kaasa. withRotation eemaldab kärpe: see on
  // eelmise pöörde raamis.
  const rotateBy = (delta: number) => {
    if (!page) return;
    const next = withRotation(page, addRotation(page.rotate ?? 0, delta));
    onPageChange(pageNum, { rotate: next.rotate, adjust: next.adjust });
  };

  // --- Poolitusjoon kärpe raamis (ADR 0085) ---
  const setX = (x: number) => onPageChange(pageNum, { mode: 'custom', split_x: x });
  // Klõps paneb joone ainult poolitataval lehel — poolituse lülitab sisse nupp.
  clickRef.current = (p: Pt) => {
    if (splits) setX(splitXFromPoint(splitQuad, p));
  };
  const cropAreaRef = useRef<HTMLDivElement>(null);
  const { startDrag } = useSplitGuideDrag(cropAreaRef, (p) => splitXFromPoint(splitQuad, p), setX);

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
        {/* Päis: sama kuju kui teose halduse pildiredaktoris — leht, mis selle lehega
            ootel on; paremal harv toiming ja sulgemine. */}
        <div className="flex flex-shrink-0 flex-nowrap items-center gap-x-3 rounded-t border-b border-gray-200 bg-white px-4 py-2.5">
          <h3 className="whitespace-nowrap font-semibold text-gray-900">
            {t('common:pagePrep.page', { cur: index + 1, total: plan.pages.length })}
          </h3>
          {/* Ühel real (flex-nowrap + overflow-hidden): päise kõrgus ei tohi sõltuda lehe
              olekust, muidu hüppab pilt (ADR 0085). */}
          <div className="flex min-w-0 flex-1 flex-nowrap items-center gap-2 overflow-hidden">
            <PendingGroup
              rotate={page.rotate ?? 0} adjust={page.adjust ?? null}
              splitPercent={splits ? Math.round(liveX * 1000) / 10 : null}
              // Pööre eemaldab ka kärpe (withRotation); kast lähtestub pöörde muutusel.
              onRotateClear={() => onPageChange(pageNum, { rotate: 0, adjust: null })}
              // Ekraanil olev kast = ootel kärbe (ADR 0085) → eemaldus võtab ka kasti maha.
              onAdjustClear={() => { crop.clearCrop(); onPageChange(pageNum, { adjust: null }); }}
              onSplitClear={() => onPageChange(pageNum, { mode: 'nosplit', split_x: null })}
              testIdPrefix="detail" />
            {!splits && !excluded && (
              <span data-testid="detail-split-state" className="text-xs text-gray-500">{t('common:pagePrep.notSplit')}</span>
            )}
            {excluded && (
              <span data-testid="detail-excluded-state" className="whitespace-nowrap text-xs font-medium text-red-700">
                {t('step3split.isExcluded')}
              </span>
            )}
          </div>
          {/* Väljajätmine on upload'i oma toiming (halduses seda pole) ja käib ka tulemuse
              eelvaates: otsus „see leht ei tule teosesse" ei sõltu vaatest. Punane rist:
              leht jääb TEOSEST välja (mitte ainult OCR-ist). Välja jäetud lehel on nupp
              tagasivõtmine (neutraalne), sest punane olek on juba päises näha. */}
          <button
            type="button"
            data-testid="detail-exclude"
            aria-pressed={excluded}
            className={`flex flex-shrink-0 items-center gap-1.5 whitespace-nowrap rounded border px-2.5 py-1.5 text-sm ${
              excluded ? 'border-gray-300 text-gray-700 hover:bg-gray-100' : 'border-red-300 text-red-700 hover:bg-red-50'
            }`}
            onClick={() => onPageChange(pageNum, { excluded: !excluded })}
          >
            {excluded ? <UndoIcon size={15} /> : <X size={15} />}
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
          {/* Vasak tööriistaveerg (ühine halduse redaktoriga). Tulemuse eelvaates on muutmine
              lukus → tühi koht sama laiusega, et pilt ei nihkuks. */}
          {showResult
            ? <div aria-hidden="true" className="w-14 flex-shrink-0" />
            : <EditToolbar crop={crop} onRotate={rotateBy} testIdPrefix="detail" />}
          <div
            ref={boxRef}
            className="relative flex h-full min-w-0 flex-1 select-none touch-none items-center justify-center"
          >
            <img
              ref={imgRef}
              src={prepressPreviewUrl(
                uploadId, pageNum, ticket, page?.rotate ?? 0,
                showResult ? visibleAdjust : null,
              ) || undefined}
              alt={`${pageNum}`}
              // Võti renderdusest, mis selle src-i pani → kast kuulub sellele lehele.
              onLoad={() => { measure(); setLoadedKey(pageKey); }}
              className="block max-h-full max-w-full object-contain"
              draggable={false}
            />
            {/* Töövaade: kärpekast ja joon PILDI kasti järgi (vt imgBox). Joon on nähtaval
                AINULT siis, kui leht päriselt poolitatakse. */}
            {!showResult && imgBox.width > 0 && (
              <div
                ref={cropAreaRef}
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
                {splits && (
                  <SplitGuide segment={splitSegment(splitQuad, liveX)} onHandleDown={startDrag}
                    lineTestId="detail-line" handleTestId="detail-handle" />
                )}
              </div>
            )}

            {/* Tulemus: serveri eelvaade kärpega — raam ütleb, et pilt pole veel lõigatud. */}
            {showResult && visibleAdjust && imgBox.width > 0 && (
              <CroppedPreviewMark className="absolute box-border" style={{
                left: imgBox.left, top: imgBox.top, width: imgBox.width, height: imgBox.height,
              }} />
            )}
            {showResult && splits && imgBox.width > 0 && (
              <div data-testid="detail-result-line" className="pointer-events-none absolute w-0.5 bg-red-500 opacity-90"
                style={{ left: imgBox.left + liveX * imgBox.width, top: imgBox.top, height: imgBox.height }} />
            )}

            {/* Väljajäetud leht: tuhm kiht + selgitus. Ei püüa hiirt — kärpida saab ikka. */}
            {excluded && imgBox.width > 0 && (
              <div
                data-testid="detail-nosplit-badge"
                className="pointer-events-none absolute flex flex-col items-center justify-start gap-1 bg-white/40 pt-6"
                style={{
                  left: imgBox.left, top: imgBox.top,
                  width: imgBox.width, height: imgBox.height,
                }}
              >
                <span className="flex items-center gap-2 rounded-full bg-red-600/90 px-4 py-2 text-sm font-medium text-white shadow-lg">
                  <X size={15} />
                  {t('step3split.isExcluded')}
                </span>
                {/* Ilma tagajärjeta jäi õhku, MIS väljajäetud lehest saab:
                    ta ei jõua OCR-i ega teosesse, seega ka poolitamine ei
                    puutu teda. Poolitusolek ise jääb plaani alles. */}
                <span
                  data-testid="detail-excluded-explain"
                  className="max-w-[22rem] rounded bg-gray-900/70 px-3 py-1 text-center text-xs text-white shadow"
                >
                  {t('step3split.excludedExplain')}
                </span>
              </div>
            )}
          </div>
          <PageFilmstrip items={filmstripItems} currentIndex={index} onSelect={goTo} testIdPrefix="detail" />
        </div>

        <div className="flex-shrink-0 space-y-2 rounded-b border-t border-gray-200 bg-white px-4 py-3">
          {/* Jalus järgib halduse redaktorit: vasakul Ülevaatesse | poolitus ja tulemus,
              paremal liikumine (‹ N / M ›). Värvi leping: must = seda lehte EI poolitata /
              EI OCR-ita; aria-pressed käib värviga kaasas. */}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <BackToOverview onBack={onClose} />
              <div className="ml-1 flex flex-wrap items-center gap-2 border-l border-gray-200 pl-3">
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
                  <SplitIcon size={15} />
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
                <button
                  type="button"
                  data-testid="detail-result-toggle"
                  aria-pressed={showResult}
                  onClick={() => setShowResult((v) => !v)}
                  className={`flex items-center gap-1.5 rounded border px-3 py-1.5 text-sm ${
                    showResult ? 'border-indigo-600 bg-indigo-50 font-medium text-indigo-700' : 'border-gray-300 hover:bg-gray-100'
                  }`}
                >
                  {showResult ? <EyeOff size={15} /> : <Eye size={15} />}
                  {showResult ? t('common:pagePrep.hideResult') : t('common:pagePrep.showResult')}
                </button>
              </div>
            </div>

            {/* Liikumine paremas servas (ADR 0085). Kõik on kohe ootel → eraldi „Järgmine"
                nuppu pole. „Kärbi ja järgmine" ilmub ainult pakkumise korral ja noolte
                VASAKULE, et nooled ei nihkuks. */}
            <div className="flex flex-shrink-0 items-center gap-3">
              {crop.proposal && (
                <button
                  type="button"
                  data-testid="detail-mark"
                  onClick={advance}
                  className="flex items-center gap-2 rounded bg-indigo-600 px-4 py-2 text-sm text-white transition-colors hover:bg-indigo-700"
                >
                  {!hasNext
                    ? <><Check size={14} />{t('common:pagePrep.acceptCrop')}</>
                    : <>{t('common:pagePrep.acceptAndNext')}<ChevronRight size={14} /></>}
                </button>
              )}
              <PageNav onPrev={() => goTo(index - 1)} onNext={() => goTo(index + 1)} hasPrev={hasPrev} hasNext={hasNext}
                current={index + 1} total={plan.pages.length} />
            </div>
          </div>
          {/* Fikseeritud kõrgus (2 rida): vihje sisu muutub (perspektiiv, tulemus), aga jaluse
              kõrgus ei tohi — muidu hüppab pilt (ADR 0085). */}
          <p data-testid="prep-hint" className="line-clamp-2 h-8 overflow-hidden text-xs leading-4 text-gray-500">
            {showResult ? t('common:pagePrep.resultHint') : <>
              {crop.perspective ? t('common:pagePrep.perspectiveHint') : t('common:pagePrep.cropHint')}
              {' '}{t('common:pagePrep.splitClickHint')}
            </>}
            {' '}{t('step3split.detail.editHint')}
          </p>
        </div>
      </div>
    </div>
  );
};

export default SplitPageDetail;
