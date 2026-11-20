// ⚠ KAKS PILDIREDAKTORIT: see ja upload/components/SplitPageDetail.tsx peavad välja nägema ja käituma ühtmoodi.
// Ühine osa on `components/pagePrep/`; muudatus ühes vaates tähendab, et kontrolli ka teist
// (vt CLAUDE.md „Kaks pildiredaktorit“).
import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { useAdminImageTicket } from '../hooks/useAdminImageTicket';
import { X, Loader2, AlertTriangle, ChevronRight, Check, Upload, MoreHorizontal, Eye, EyeOff } from 'lucide-react';
import { SplitIcon, UndoIcon } from './icons';
import { useTranslation } from 'react-i18next';
import { IMAGE_BASE_URL } from '../config';
import { useUser } from '../contexts/UserContext';
import { restoreOriginalPageImage } from '../services/pageService';
import { workPagePreviewUrl } from '../services/workApi';
import { adjustFromParams } from '../pages/upload/prepressPlan';
import type { PageAdjust } from '../pages/upload/types';
import { expandedBoundingBox } from '../utils/imageTransformGeometry';
import { addRotation } from './pagePrep/geometry';
import SplitGuide, { useSplitGuideDrag } from './pagePrep/SplitGuide';
import { outputQuad, splitSegment, splitXFromPoint, type Pt } from './pagePrep/splitGeometry';
import EditToolbar from './pagePrep/EditToolbar';
import CroppedPreviewMark from './pagePrep/CroppedPreviewMark';
import { BackToOverview, PageNav } from './pagePrep/PageNavFooter';
import PendingGroup from './pagePrep/PendingGroup';
import PendingOutline from './pagePrep/PendingOutline';
import PageFilmstrip, { type FilmstripItem } from './pagePrep/PageFilmstrip';
import { useCropBox } from './pagePrep/useCropBox';
import { usePendingCrop } from './pagePrep/usePendingCrop';
import CropOverlay from './pagePrep/CropOverlay';
import { effectiveSplitX, pendingCount, showsCardLine, type PendingPageOp } from '../pages/manage/pageOpsPlan';
import { manageThumb } from '../pages/manage/pageThumb';
import ExemplarOriginSelect from '../pages/manage/ExemplarOriginSelect';
import type { Exemplar } from '../types';

interface PageInfo {
  filename: string;
  page_num: number;
}

interface Props {
  workId: string;
  pages: PageInfo[];                // järjestatud
  initialIndex: number;
  imageToken: { exp: number; sig: string } | null;
  onClose: () => void;
  onPagesChanged: () => Promise<string[]>;  // laeb pages uuesti, tagastab uue failinimede massiivi
  onReplaceImage: (file: File, pageNum: number, origin?: string) => Promise<void>;  // asendab lehe pildi; viskab vea ebaõnnestumisel
  /** Teose eksemplarid (ADR 0076): olemasolul on asenduspildi päritolu kohustuslik. */
  exemplars?: Exemplar[];
  cacheBust: number;  // muutub iga pildi-mutatsiooni järel (kärbe/pööre/poolitus/asendus) → eelvaade värske
  /**
   * Poolitus on OOTEL plaan (#431, ADR 0050), nagu upload'i detailvaates: joon
   * kirjutatakse teose halduse plaani ja rakendub riba „Rakenda" nupust koos
   * teiste ootel muudatustega. Modaal ei hoia joont oma olekus — muidu kadus
   * see sulgemisel ja järgmine avamine algas jälle 50 % pealt.
   */
  pendingOps: Record<string, PendingPageOp>;
  globalSplitX: number;
  /** split=false → ära poolita; split_x=null → üldjoon. */
  onSplitChange: (filename: string, change: { split: boolean; split_x: number | null }) => void;
  /**
   * Pööre + kärbe/kalle/perspektiiv on samuti OOTEL plaan (ADR 0061): „Märgi"
   * kirjutab plaani, kettale jõuab see riba „Rakenda" nupust. adjust=null →
   * ainult pööre (kärbe kuulus eelmisse raami ja kaob).
   */
  onEditChange: (filename: string, rotate: number, adjust: PageAdjust | null) => void;
  /** „Eemalda kärbe" — pööre ja poolitus jäävad. */
  onAdjustClear: (filename: string) => void;
  /**
   * „Rakenda kõik" otse redaktorist: sulgeb redaktori ja avab teose halduse
   * rakendamise kinnituse. Kasutaja ei pidanud varem aru saama, et pööre, kärbe
   * ja poolitus on OOTEL ning rakendus käib ülevaate ribalt — nüüd on tee siin.
   */
  onApplyAll?: () => void;
}

// Eelvaate vaikimisi mõõdud (px) — kasutatakse ainult esimese paindeni, enne kui
// ResizeObserver on tegeliku "lava" (saadaoleva ruumi) ära mõõtnud.
const DEFAULT_STAGE_W = 680;
const DEFAULT_STAGE_H = 540;

const PageImageEditorModal: React.FC<Props> = ({
  workId, pages, initialIndex, imageToken, onClose, onPagesChanged, onReplaceImage, cacheBust,
  pendingOps, globalSplitX, onSplitChange, onEditChange, onAdjustClear, onApplyAll, exemplars = [],
}) => {
  const { t } = useTranslation(['workspace', 'common']);
  const { authToken } = useUser();
  const ticket = useAdminImageTicket(`work:${workId}`, authToken);

  const [currentIndex, setCurrentIndex] = useState(initialIndex);
  // „Näita tulemust" (ADR 0085): serveri eelvaade nähtava pöörde ja kärpega, ainult vaatamiseks.
  const [showResult, setShowResult] = useState(false);

  // Pildi naturaalmõõdud koos võtmega (leht + versioon): lehe vahetuse renderdusel on
  // vanad mõõdud veel olekus — `imgReady` ei tohi neid uue lehe omaks pidada.
  const [imgNatural, setImgNatural] = useState<{ w: number; h: number; key: string } | null>(null);
  // Tulemuse eelvaate mõõdud (serveri renderdus, ADR 0061).
  const [previewNatural, setPreviewNatural] = useState<{ w: number; h: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showRestoreConfirm, setShowRestoreConfirm] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [replacing, setReplacing] = useState(false);          // pildi asendamine käib
  const replaceInputRef = useRef<HTMLInputElement>(null);
  const [replaceOrigin, setReplaceOrigin] = useState('');
  // Harvad toimingud (asenda pilt, taasta originaal) on „Veel" menüüs; päritolu
  // küsitakse alles asenduse juures, mitte päises kogu aeg (ADR 0076 p 4 reegel jääb).
  const [menuOpen, setMenuOpen] = useState(false);
  const [showReplace, setShowReplace] = useState(false);
  const originMissing = exemplars.length > 0 && !replaceOrigin;
  const [toast, setToast] = useState<{ text: string; action?: { label: string; run: () => void } } | null>(null);

  // Pildi raam (kuvatav, jämeda pöörde laiendatud kast) — joone ja klõpsu koordinaadid.
  const frameRef = useRef<HTMLDivElement>(null);
  // "Lava" = paindlik ala, kuhu pilt mahutatakse. Mõõdame selle tegeliku suuruse,
  // et pilt mahuks alati ekraanile (ei jää modaali serva taha kitsal vertikaalruumil).
  const stageRef = useRef<HTMLDivElement>(null);
  const [stage, setStage] = useState<{ w: number; h: number }>({ w: DEFAULT_STAGE_W, h: DEFAULT_STAGE_H });

  const safeIndex = Math.max(0, Math.min(currentIndex, pages.length - 1));
  const current = pages[safeIndex];
  const hasCurrent = Boolean(current);

  // Poolituse olek tuleb ootel plaanist (vt Props.pendingOps).
  const pendingOp = current ? pendingOps[current.filename] : undefined;
  const willSplit = Boolean(pendingOp?.split);
  const splitX = pendingOp?.split_x ?? globalSplitX;
  // Ootel pööre rakendub ENNE poolitust → joon kehtib pööratud (ja kärbitud) lehele.
  const pendingRotate = pendingOp?.rotate ?? 0;
  // Pööre on kohe ootel (ADR 0085) → kuvatav jäme pööre ON ootel pööre.
  const grossAngle = pendingRotate;
  const pendingAdjust = pendingOp?.adjust ?? null;
  // Lehe-vahetuse effectile: ootel kärbega lehele ei panda kleepuvat kasti.
  const hasPendingAdjustRef = useRef(false);
  hasPendingAdjustRef.current = !!pendingAdjust;

  // Mõõda lava tegelik suurus (uueneb akna/modaali muutudes).
  // Väike varu (-4 px), et piir/vari ei tekitaks ülevoolu.
  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const measure = () => setStage({
      w: Math.max(0, el.clientWidth - 4),
      h: Math.max(0, el.clientHeight - 4),
    });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [hasCurrent]);

  const imageUrl = (() => {
    if (!current) return '';
    const base = `${IMAGE_BASE_URL}/${workId}/${current.filename}`;
    const params = new URLSearchParams();
    if (imageToken) { params.set('exp', String(imageToken.exp)); params.set('sig', imageToken.sig); }
    if (cacheBust) params.set('v', String(cacheBust));  // cache-bust iga mutatsiooni järel
    const qs = params.toString();
    return qs ? `${base}?${qs}` : base;
  })();

  // Eelvaate geomeetria: jäme pööre (grossAngle) rakendub PILDILE; kast tilditakse eraldi.
  const natural = imgNatural ?? { w: 4, h: 3 };
  const expanded = expandedBoundingBox(natural.w, natural.h, grossAngle);
  // Mahuta lavasse; ', 1' = ära suurenda üle natiivse resolutsiooni (ei udusta).
  const fit = Math.min(stage.w / expanded.width, stage.h / expanded.height, 1);
  const displayW = expanded.width * fit;
  const displayH = expanded.height * fit;
  const imgDispW = natural.w * fit;
  const imgDispH = natural.h * fit;
  // --- Kärpe/kalle/perspektiiv --- ühine upload'i ülevaatusega (#431).
  // Klõps ilma liikumiseta = poolitusjoon (ADR 0085); käsitleja on allpool (vajab joone raami).
  const clickRef = useRef<(p: Pt) => void>(() => {});
  const imgKey = `${current?.filename}:${cacheBust}`;
  const imgReady = imgNatural?.key === imgKey;
  const crop = useCropBox(displayW, displayH, imgReady, { onClick: (p) => clickRef.current(p) });
  const resetCrop = crop.reset;

  // Lähtesta + mõõda uuesti, kui leht vahetub VÕI pildi sisu muutub (cacheBust uueneb
  // iga mutatsiooni järel — nt kärbe muudab kuvasuhet). crop.reset paneb kleepuva
  // pakkumise (ootel kärbega lehel mitte — see taastatakse kastina, usePendingCrop).
  useEffect(() => {
    setImgNatural(null);
    setError(null);
    setShowResult(false);
    resetCrop(!hasPendingAdjustRef.current);
  }, [current?.filename, cacheBust, resetCrop]);

  // Jäme 90°/180° pööre läheb KOHE ootel plaani (ADR 0085). Kärbe kaob: see kuulus
  // eelmisse raami (sama reegel mis upload'is, `withRotation`).
  const rotateBy = (delta: number) => {
    if (!current) return;
    onEditChange(current.filename, addRotation(pendingRotate, delta), null);
    crop.onGrossRotate();
  };

  // --- Navigeerimine ---
  // Teade kaob ise (lisategevusega teade jääb, kuni kasutaja otsustab).
  useEffect(() => {
    if (!toast || toast.action) return;
    const id = window.setTimeout(() => setToast(null), 5000);
    return () => window.clearTimeout(id);
  }, [toast]);

  const goTo = useCallback((idx: number) => {
    setCurrentIndex(Math.max(0, Math.min(pages.length - 1, idx)));
    setToast(null);
  }, [pages.length]);

  // Pisipiltide riba: sama pisipilt ja joon mis ruudustiku kaardil (`manageThumb`,
  // `showsCardLine`) — 90°/270° CSS-pöördega pisipildil joont ei näidata.
  const filmstripItems = useMemo<FilmstripItem[]>(() => pages.map((p) => {
    const op = pendingOps[p.filename];
    const thumb = manageThumb({
      workId, imageName: p.filename, filename: p.filename, op,
      ticket, imageToken, cacheBust,
    });
    return {
      key: p.filename,
      src: thumb.src,
      imgStyle: thumb.imgStyle,
      splitX: showsCardLine(op) ? effectiveSplitX(op, globalSplitX) : null,
      pending: op ? { rotate: op.rotate !== 0, crop: Boolean(op.adjust), split: op.split } : null,
    };
  }), [pages, pendingOps, workId, ticket, imageToken, cacheBust, globalSplitX]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const tag = (document.activeElement?.tagName || '').toUpperCase();
      const role = (document.activeElement as HTMLElement | null)?.getAttribute('role');
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(tag) || role === 'slider') return;
      if (e.key === 'ArrowLeft') goTo(currentIndex - 1);
      else if (e.key === 'ArrowRight') goTo(currentIndex + 1);
      else if (e.key === 'Escape') { if (menuOpen) setMenuOpen(false); else onClose(); }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [currentIndex, goTo, onClose, menuOpen]);

  // --- Kõik on kohe ootel (ADR 0085) ---
  // Ekraanil olev kast = ootel kärbe: taastatakse lehele tulles ja iga muudatus läheb kohe
  // plaani. Kleepuv kast on pakkumine — plaani alles puudutamisel või põhinupu peale.
  usePendingCrop({
    crop, pendingAdjust, pageKey: `${imgKey}:${pendingRotate}`, ready: imgReady,
    onCommit: (adjust) => { if (current) onEditChange(current.filename, pendingRotate, adjust); },
  });
  // Joone raam = plaani kärbe. Lohistuse ajal järgib joon kasti juba enne kirjutust.
  const visibleAdjust: PageAdjust | null = crop.userEdited
    ? adjustFromParams(crop.toServerParams(0))
    : pendingAdjust;
  const splitQuad = outputQuad(visibleAdjust, displayW, displayH);
  const isLast = safeIndex >= pages.length - 1;
  // Põhinupp: pakkumise korral „Kärbi ja järgmine" (võtab kasti vastu), muidu „Järgmine".
  const advance = () => {
    if (!current) return;
    if (crop.proposal) {
      onEditChange(current.filename, pendingRotate, adjustFromParams(crop.toServerParams(0)));
      crop.acceptProposal();
      setError(null);
      if (isLast) setToast({ text: t('manage.editor.allDone') });
    }
    if (!isLast) goTo(safeIndex + 1);
  };

  // --- Poolitusjoon kärpe raamis (ADR 0085) ---
  const setSplitAt = (x: number) => {
    if (current) onSplitChange(current.filename, { split: true, split_x: x });
  };
  // Klõps paneb joone ainult poolitataval lehel — poolituse lülitab sisse nupp.
  clickRef.current = (p: Pt) => {
    if (willSplit) setSplitAt(splitXFromPoint(splitQuad, p));
  };
  const { startDrag: startSplitDrag } = useSplitGuideDrag(
    frameRef, (p) => splitXFromPoint(splitQuad, p), setSplitAt,
  );

  // Tulemuse eelvaade: serveri renderdus nähtava pöörde ja kärpega (CSS ei kattu lõikega).
  const resultUrl = showResult && current && ticket
    ? workPagePreviewUrl(workId, current.filename, ticket, grossAngle, visibleAdjust, 'view', cacheBust)
    : null;
  useEffect(() => { setPreviewNatural(null); }, [resultUrl]);
  const resultNat = previewNatural ?? { w: displayW, h: displayH };
  const resultFit = Math.min(stage.w / resultNat.w, stage.h / resultNat.h, 1);
  const resultW = resultNat.w * resultFit;
  const resultH = resultNat.h * resultFit;

  // Taasta lehe ._originals pristine pilt (destruktiivne: kõik pildimuudatused kaovad).
  // Restore puudutab AINULT pilti; tekst/JSON jäävad. Poolitatud poolel → topeltlehekülg.
  const doRestoreOriginal = async () => {
    if (!authToken || !current) return;
    setShowRestoreConfirm(false);
    setRestoring(true);
    setError(null);
    setToast(null);
    try {
      const r = await restoreOriginalPageImage(workId, current.filename, authToken);
      if (!r.restored && r.reason === 'no_original') {
        setToast({ text: t('manage.editor.noOriginal') });
        return;
      }
      // Ootel kärbe oli vana pildi raamis.
      onAdjustClear(current.filename);
      await onPagesChanged();
      setToast({ text: t('manage.editor.restoreDone') });
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : t('manage.editor.restoreError'));
    } finally {
      setRestoring(false);
    }
  };

  // Asenda lehe pilt (harv: parema kvaliteediga skann). Edu korral lähtesta teisendused
  // ja cache-busti eelvaade; viga näita modaalis.
  const onReplaceFile = async (file: File) => {
    if (!current) return;
    setReplacing(true);
    setError(null);
    try {
      await onReplaceImage(file, current.page_num, replaceOrigin || undefined);
      setShowReplace(false);
      onAdjustClear(current.filename);  // ootel kärbe oli vana pildi raamis
      // cacheBust uueneb parent'is (thumbCacheBust) → reset-effekt mõõdab pildi uuesti ja lähtestab teisendused
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : t('manage.replaceError'));
    } finally {
      setReplacing(false);
    }
  };

  // Kogu teose ootel lehed (mitte ainult see leht) — riba ja „Rakenda kõik".
  const totalPending = pendingCount(pendingOps);
  // „Rakenda kõik" rakendab AINULT ootel plaani — mida kasutaja on „Märgi"-ga
  // selgesõnaliselt märkinud. Selle lehe märkimata muudatus (pööre, kärbe, ka
  // automaatselt ette pandud kleepuv kast) jääb rakendamata: kaudne lisamine kärpis
  // lehti, mida kasutaja ei tahtnud kärpida (2026-11-17).
  const applyAll = () => {
    if (!onApplyAll) return;
    onApplyAll();
  };
  const startReplace = () => {
    setMenuOpen(false);
    setShowRestoreConfirm(false);
    if (exemplars.length > 0) setShowReplace(true);
    else replaceInputRef.current?.click();
  };

  if (!current) return null;

  // Laadija täidab lava — kuvame kuni naturaalmõõdud teada (väldib aspect-venitust).
  const loadingBox = (
    <div className="flex items-center justify-center bg-white shadow-inner border border-gray-200 w-full h-full">
      <Loader2 size={28} className="animate-spin text-gray-300" />
    </div>
  );


  return (
    // Raam, kõrgus ja jaluse nupurühm järgivad upload'i detailvaadet
    // (`SplitPageDetail`): sama töö („vaata → otsusta → järgmine"), sama kuju.
    // Ühine moodul nad ei ole — vajadused erinevad (asendus, taaste, andmeallikas).
    <div className="fixed inset-0 z-[1300] flex items-center justify-center overflow-hidden bg-black/70 p-2 sm:p-4">
      <div
        role="dialog"
        aria-label={t('manage.editor.title')}
        className="flex h-[calc(100vh-1rem)] w-full max-w-6xl flex-col rounded bg-white sm:h-[calc(100vh-2rem)]"
      >
        {/* Päis: mis leht, mis vaade, mis selle lehega juhtub. */}
        <div className="flex flex-shrink-0 flex-nowrap items-center gap-x-3 rounded-t border-b border-gray-200 bg-white px-4 py-2.5">
          <h2 className="whitespace-nowrap font-semibold text-gray-900">
            {t('common:pagePrep.page', { cur: safeIndex + 1, total: pages.length })}
          </h2>

          {/* Selle lehe ootel muudatused: kiibid, igaühel oma ✕. Ühel real (flex-nowrap +
              overflow-hidden): päise kõrgus ei tohi sõltuda lehe olekust, muidu hüppab
              pilt (ADR 0085). */}
          <div className="flex min-w-0 flex-1 flex-nowrap items-center gap-2 overflow-hidden">
            <PendingGroup
              rotate={pendingRotate} adjust={pendingAdjust}
              splitPercent={willSplit ? Math.round(splitX * 1000) / 10 : null}
              // Pööre eemaldab ka kärpe (see kuulus pööratud raami), nagu pööramisnupud.
              onRotateClear={() => { onEditChange(current.filename, 0, null); crop.onGrossRotate(); }}
              // Ekraanil olev kast = ootel kärbe (ADR 0085) → eemaldus võtab ka kasti maha.
              onAdjustClear={() => { crop.clearCrop(); onAdjustClear(current.filename); }}
              onSplitClear={() => onSplitChange(current.filename, { split: false, split_x: pendingOp?.split_x ?? null })}
              testIdPrefix="editor" />
            {!willSplit && (
              <span data-testid="editor-split-state" className="text-xs text-gray-500">{t('common:pagePrep.notSplit')}</span>
            )}
          </div>

          {/* Kogu teose „Rakenda kõik" — eraldi nupp, mitte lehe kiipide seas: kehtib
              KÕIGILE ootel lehtedele. Oranž = ootel muudatuste toiming (salvestusnupu kokkulepe). */}
          {totalPending > 0 && onApplyAll && (
            <button data-testid="editor-apply-all" onClick={applyAll}
              title={t('manage.editor.pendingChipTitle')}
              className="flex flex-shrink-0 items-center gap-1.5 whitespace-nowrap rounded bg-amber-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-amber-700">
              <Check size={15} />{t('manage.editor.applyAll', { count: totalPending })}
            </button>
          )}

          {/* Harvad toimingud */}
          <div className="relative flex flex-shrink-0 items-center gap-1">
            <input
              ref={replaceInputRef}
              type="file"
              accept="image/jpeg,image/png"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) onReplaceFile(file);
                if (replaceInputRef.current) replaceInputRef.current.value = '';
              }}
            />
            <button
              data-testid="editor-more"
              onClick={() => setMenuOpen((o) => !o)}
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              disabled={restoring || replacing}
              className="flex items-center gap-1.5 rounded border border-gray-300 px-2.5 py-1.5 text-sm text-gray-700 hover:bg-gray-100 disabled:opacity-50"
            >
              {restoring || replacing ? <Loader2 size={15} className="animate-spin" /> : <MoreHorizontal size={15} />}
              {t('manage.editor.more')}
            </button>
            {menuOpen && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setMenuOpen(false)} />
                <div role="menu" className="absolute right-8 top-full z-20 mt-1 w-56 rounded-md border border-gray-200 bg-white py-1 shadow-lg">
                  <button role="menuitem" data-testid="editor-replace" onClick={startReplace}
                    className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-gray-700 hover:bg-gray-100">
                    <Upload size={14} />{t('manage.editor.replaceMenu')}
                  </button>
                  <button role="menuitem" data-testid="editor-restore"
                    onClick={() => { setMenuOpen(false); setShowReplace(false); setShowRestoreConfirm(true); }}
                    className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-gray-700 hover:bg-gray-100">
                    <UndoIcon size={14} />{t('manage.editor.restoreOriginal')}
                  </button>
                </div>
              </>
            )}
            <button onClick={onClose} aria-label={t('manage.editor.close')}
              className="-mr-1 rounded p-2 text-gray-500 hover:bg-gray-100 hover:text-gray-900">
              <X size={18} />
            </button>
          </div>
        </div>

        {/* Lava: pilt saab kogu ruumi; pööre/perspektiiv on vasakul fikseeritud ribal
            (ei hõlju ega kata pilti, jalus ei kasva). */}
        <div className="relative flex min-h-0 flex-1 flex-row gap-3 overflow-hidden bg-gray-50 p-4">
          {/* Teade hõljub lava peal (ei kuulu jaluse voogu) — jalus ei kasva ja pilt ei hüppa. */}
          {toast && (
            <div role="status" data-testid="editor-toast"
              className="absolute left-1/2 top-3 z-10 flex -translate-x-1/2 items-center gap-3 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm text-emerald-800 shadow-lg">
              <span className="flex items-center gap-2"><Check size={14} /> {toast.text}</span>
              {toast.action && (
                <button onClick={toast.action.run} className="font-medium text-emerald-700 underline hover:text-emerald-900">
                  {toast.action.label}
                </button>
              )}
              <button onClick={() => setToast(null)} aria-label={t('manage.editor.close')}
                className="-mr-1 rounded p-0.5 text-emerald-600 hover:bg-emerald-100"><X size={14} /></button>
            </div>
          )}
          {/* Tulemuse eelvaates on muutmine lukus → tööriistariba asemel tühi koht sama laiusega,
              et pilt ei nihkuks. */}
          {showResult
            ? <div aria-hidden="true" className="w-14 flex-shrink-0" />
            : <EditToolbar crop={crop} onRotate={rotateBy} testIdPrefix="editor" />}
          {/* Peidetud laadija: mõõdab pildi naturaalmõõdud enne kuvamist (väldib aspect-venitust) */}
          {!imgReady && (
            <img
              src={imageUrl}
              alt=""
              draggable={false}
              className="hidden"
              onLoad={(e) => setImgNatural({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight, key: imgKey })}
            />
          )}
          <div ref={stageRef} className="relative flex min-h-0 min-w-0 flex-1 items-center justify-center overflow-hidden">
            {!imgReady ? loadingBox : showResult ? (
              // Tulemus: serveri renderdus, joon sirge (kärbitud pildi laiuse osa). Ainult vaatamiseks.
              <div data-testid="editor-result" className="relative select-none overflow-hidden rounded border border-gray-200"
                style={{ width: resultW, height: resultH }}>
                {resultUrl ? (
                  <img
                    data-testid="editor-result-image"
                    src={resultUrl}
                    alt={current.filename}
                    className="pointer-events-none absolute inset-0 max-w-none"
                    draggable={false}
                    style={{ width: resultW, height: resultH }}
                    onLoad={(e) => setPreviewNatural({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })}
                  />
                ) : loadingBox}
                {visibleAdjust && <CroppedPreviewMark />}
                {willSplit && (
                  <div data-testid="editor-result-line" className="pointer-events-none absolute bottom-0 top-0 w-0.5 bg-red-500 opacity-90"
                    style={{ left: splitX * resultW }} />
                )}
              </div>
            ) : (
              <div
                ref={frameRef}
                className="relative border border-gray-200 bg-white shadow-inner"
                style={{ width: displayW, height: displayH }}
              >
                {/* Pilt seisab (jäme pööre), kärpe-kasti saab kallutada */}
                <img
                  src={imageUrl}
                  alt={current.filename}
                  draggable={false}
                  // max-w-none: Tailwindi preflight seab img-le max-width:100%, mis 90°/270°
                  // pöördel kärbiks RÕHTSA pildi laiuse konteineri (expand'itud kasti) laiuseks
                  // — element muutuks ruuduks ja eelvaade paistaks kokkusurutud.
                  className="pointer-events-none absolute max-w-none select-none"
                  style={{
                    width: imgDispW,
                    height: imgDispH,
                    left: '50%', top: '50%',
                    transform: `translate(-50%, -50%) rotate(${grossAngle}deg)`,
                  }}
                />
                {!crop.hasEdit && (
                  <PendingOutline adjust={pendingAdjust} width={displayW} height={displayH} />
                )}
                {/* Kärpe-overlay (püüab hiire: lohistus = kast, klõps = joon) */}
                <CropOverlay crop={crop} deskewTitle={t('common:pagePrep.deskew')} />
                {/* Joon kärpe raamis, overlay kohal — käepide peab olema haaratav. */}
                {willSplit && (
                  <SplitGuide segment={splitSegment(splitQuad, splitX)} onHandleDown={startSplitDrag}
                    lineTestId="editor-split-line" handleTestId="editor-split-handle" />
                )}
              </div>
            )}
          </div>
          <PageFilmstrip items={filmstripItems} currentIndex={safeIndex} onSelect={goTo} testIdPrefix="editor" />
        </div>

        {/* Jalus */}
        <div className="flex-shrink-0 space-y-2 rounded-b border-t border-gray-200 bg-white px-4 py-3">
          {error && (
            <div className="flex items-center gap-2 rounded border border-red-200 bg-red-50 p-3 text-sm text-red-700">
              <AlertTriangle size={14} /> {error}
            </div>
          )}
          {showRestoreConfirm && (
            <div className="space-y-2 rounded border border-amber-200 bg-amber-50 p-3">
              <p className="text-sm text-amber-800">{t('manage.editor.restoreConfirmBody')}</p>
              <div className="flex gap-2">
                <button onClick={doRestoreOriginal} className="rounded bg-amber-600 px-3 py-1 text-sm text-white hover:bg-amber-700">
                  {t('manage.editor.restoreOriginal')}
                </button>
                <button onClick={() => setShowRestoreConfirm(false)} className="rounded border border-gray-300 px-3 py-1 text-sm hover:bg-gray-100">
                  {t('manage.editor.cancel')}
                </button>
              </div>
            </div>
          )}

          {/* Asendus eksemplaridega teosel: päritolu küsitakse SIIN, koos selgitusega
              (ADR 0076 p 4 — vaikevalikut ei ole). */}
          {showReplace && (
            <div data-testid="editor-replace-panel" className="space-y-2 rounded border border-gray-200 bg-gray-50 p-3">
              <p className="text-sm text-gray-800">{t('manage.editor.replaceBody')}</p>
              <div className="flex flex-wrap items-end gap-2">
                <ExemplarOriginSelect exemplars={exemplars} value={replaceOrigin} onChange={setReplaceOrigin}
                  disabled={replacing} />
                <button
                  data-testid="editor-replace-choose"
                  onClick={() => replaceInputRef.current?.click()}
                  disabled={replacing || originMissing}
                  title={originMissing ? t('manage.exemplarOrigin.required') : undefined}
                  className="flex items-center gap-1.5 rounded bg-indigo-600 px-3 py-1.5 text-sm text-white hover:bg-indigo-700 disabled:opacity-50"
                >
                  {replacing ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
                  {t('manage.editor.replaceChoose')}
                </button>
                <button onClick={() => setShowReplace(false)} disabled={replacing}
                  className="rounded border border-gray-300 px-3 py-1.5 text-sm hover:bg-gray-100">
                  {t('manage.editor.cancel')}
                </button>
              </div>
            </div>
          )}

          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <BackToOverview onBack={onClose} />
              <div className="ml-1 flex flex-wrap items-center gap-2 border-l border-gray-200 pl-3">
                <button
                  data-testid="editor-split-toggle"
                  aria-pressed={!willSplit}
                  onClick={() => onSplitChange(current.filename, { split: !willSplit, split_x: pendingOp?.split_x ?? null })}
                  className={`flex items-center gap-1.5 rounded border px-3 py-1.5 text-sm ${
                    willSplit ? 'border-gray-300 hover:bg-gray-100' : 'border-gray-900 bg-gray-900 font-medium text-white'
                  }`}
                >
                  <SplitIcon size={15} />
                  {willSplit ? t('manage.pageOps.noSplit') : t('manage.pageOps.split')}
                </button>
                {willSplit && pendingOp?.split_x != null && (
                  <button
                    onClick={() => onSplitChange(current.filename, { split: true, split_x: null })}
                    className="rounded border border-gray-300 px-3 py-1.5 text-sm hover:bg-gray-100"
                  >
                    {t('common:pagePrep.resetToGlobal')}
                  </button>
                )}
                <button
                  data-testid="editor-result-toggle"
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
                  data-testid="editor-mark"
                  onClick={advance}
                  className="flex items-center gap-2 rounded bg-indigo-600 px-4 py-2 text-sm text-white transition-colors hover:bg-indigo-700"
                >
                  {isLast
                    ? <><Check size={14} />{t('common:pagePrep.acceptCrop')}</>
                    : <>{t('common:pagePrep.acceptAndNext')}<ChevronRight size={14} /></>}
                </button>
              )}
              <PageNav onPrev={() => goTo(currentIndex - 1)} onNext={() => goTo(currentIndex + 1)} hasPrev={safeIndex > 0} hasNext={safeIndex < pages.length - 1}
                current={safeIndex + 1} total={pages.length} />
            </div>
          </div>
          {/* Fikseeritud kõrgus (2 rida): vihje sisu muutub (perspektiiv, tulemus), aga jaluse
              kõrgus ei tohi — muidu hüppab pilt (ADR 0085). */}
          <p data-testid="prep-hint" className="line-clamp-2 h-8 overflow-hidden text-xs leading-4 text-gray-500">
            {showResult ? t('common:pagePrep.resultHint') : <>
              {crop.perspective ? t('common:pagePrep.perspectiveHint') : t('common:pagePrep.cropHint')}
              {' '}{t('common:pagePrep.splitClickHint')}
            </>}
            {' '}{t('manage.editor.editPendingHint')}
          </p>
        </div>
      </div>
    </div>
  );
};

export default PageImageEditorModal;
