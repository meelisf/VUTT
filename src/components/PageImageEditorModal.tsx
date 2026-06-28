import React, { useState, useRef, useEffect, useCallback } from 'react';
import { X, Scissors, RotateCcw, RotateCw, FlipVertical2, Crop, Loader2, AlertTriangle, ChevronLeft, ChevronRight, Check, Upload, GripHorizontal, CircleX, Frame, Undo2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { FILE_API_URL, IMAGE_BASE_URL } from '../config';
import { useUser } from '../contexts/UserContext';
import { fetchWithTimeout, getAuthHeaders } from '../utils/fetchWithTimeout';
import { transformPageImage, restoreOriginalPageImage, CropRect } from '../services/pageService';
import { expandedBoundingBox } from '../utils/imageTransformGeometry';
import { computeNextAnchor, resolveIndexAfter } from '../utils/pageNavAnchor';
import { resizeRotatedBox, CropHandle, CenterBox } from '../utils/cropBoxInteraction';
import { rotatedCropToServerParams } from '../utils/rotatedCropParams';
import { defaultQuad, quadFromCropRect, quadToDisplayPx, quadPtFromDisplayPx, Quad4 } from '../utils/perspectiveQuad';

interface PageInfo {
  filename: string;
  page_num: number;
}

interface Props {
  workId: string;
  pages: PageInfo[];                // järjestatud
  initialIndex: number;
  initialTab: 'edit' | 'split';
  imageToken: { exp: number; sig: string } | null;
  onClose: () => void;
  onPagesChanged: () => Promise<string[]>;  // laeb pages uuesti, tagastab uue failinimede massiivi
  onReplaceImage: (file: File, pageNum: number) => Promise<void>;  // asendab lehe pildi; viskab vea ebaõnnestumisel
  cacheBust: number;  // muutub iga pildi-mutatsiooni järel (kärbe/pööre/poolitus/asendus) → eelvaade värske
}

// Eelvaate vaikimisi mõõdud (px) — kasutatakse ainult esimese paindeni, enne kui
// ResizeObserver on tegeliku "lava" (saadaoleva ruumi) ära mõõtnud.
const DEFAULT_STAGE_W = 680;
const DEFAULT_STAGE_H = 540;
const MIN_DRAG_PX = 8;   // alla selle ei registreeri kärbet

const PageImageEditorModal: React.FC<Props> = ({
  workId, pages, initialIndex, initialTab, imageToken, onClose, onPagesChanged, onReplaceImage, cacheBust,
}) => {
  const { t } = useTranslation(['workspace', 'common']);
  const { authToken } = useUser();

  const [currentIndex, setCurrentIndex] = useState(initialIndex);
  const [tab, setTab] = useState<'edit' | 'split'>(initialTab);
  const [grossAngle, setGrossAngle] = useState(0);   // jäme orientatsioon (90/180 nupud)
  const [boxAngle, setBoxAngle] = useState(0);        // crop-kasti kalle (deskew)
  const [cropRect, setCropRect] = useState<CropRect | null>(null);  // telg-joondatud kasti-lokaal
  const [splitX, setSplitX] = useState(0.5);
  const [perspective, setPerspective] = useState(false);   // perspektiivirežiim
  const [quad, setQuad] = useState<Quad4 | null>(null);     // 4 nurka [0..1]

  const [imgNatural, setImgNatural] = useState<{ w: number; h: number } | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showConfirm, setShowConfirm] = useState(false);
  const [showRestoreConfirm, setShowRestoreConfirm] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [skipConfirm, setSkipConfirm] = useState(false);
  const [dragging, setDragging] = useState(false);            // kärbe-interaktsioon aktiivne
  const [splitDragging, setSplitDragging] = useState(false);  // poolitusjoone lohistus aktiivne
  const [replacing, setReplacing] = useState(false);          // pildi asendamine käib
  const replaceInputRef = useRef<HTMLInputElement>(null);
  const [toast, setToast] = useState<{ text: string; action?: { label: string; run: () => void } } | null>(null);

  // Kärpe-lohistuse ajutine olek (display-pikslites)
  const [cropDraft, setCropDraft] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  // "Kleepuv" kärpe-suurus: viimati kasutatud kasti normaliseeritud mõõt. Iga uue lehe
  // avamisel ilmub sama suur tühi kast keskele (asukohta/kallet ei taastata). Ref, mitte
  // state → ei tekita re-render'it ega püsi üle modaali sulgemise. CircleX nullib selle.
  const lastCropSizeRef = useRef<{ w: number; h: number } | null>(null);
  // Aktiivne interaktsioon: uue joonistamine, liigutamine, sangaga muutmine või pööramine
  const interaction = useRef<
    | { mode: 'draw' }
    | { mode: 'move'; startX: number; startY: number; startCenter: { cx: number; cy: number } }
    | { mode: 'resize'; handle: CropHandle; startBox: CenterBox }
    | { mode: 'rotate' }
    | { mode: 'corner'; idx: number }
    | null
  >(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const splitContainerRef = useRef<HTMLDivElement>(null);
  // "Lava" = paindlik ala, kuhu pilt mahutatakse. Mõõdame selle tegeliku suuruse,
  // et pilt mahuks alati ekraanile (ei jää modaali serva taha kitsal vertikaalruumil).
  const stageRef = useRef<HTMLDivElement>(null);
  const [stage, setStage] = useState<{ w: number; h: number }>({ w: DEFAULT_STAGE_W, h: DEFAULT_STAGE_H });

  // Hõljuv nupupaneel: vabalt lohistatav (piiratud lava raamiga). null = vaikeasend (parem ülanurk).
  const toolbarRef = useRef<HTMLDivElement>(null);
  const [toolbarPos, setToolbarPos] = useState<{ x: number; y: number } | null>(null);
  const [toolbarDragging, setToolbarDragging] = useState(false);
  const toolbarGrab = useRef<{ offX: number; offY: number } | null>(null);

  const safeIndex = Math.max(0, Math.min(currentIndex, pages.length - 1));
  const current = pages[safeIndex];

  // Pildi vahetusel lähtesta teisendused
  const resetTransforms = useCallback(() => {
    setGrossAngle(0);
    setBoxAngle(0);
    setCropRect(null);
    setCropDraft(null);
    setPerspective(false);
    setQuad(null);
    setSplitX(0.5);
    setImgNatural(null);
    setError(null);
  }, []);

  // Lähtesta teisendused + mõõda uuesti, kui leht vahetub VÕI pildi sisu muutub
  // (cacheBust uueneb iga mutatsiooni järel — nt kärbe muudab kuvasuhet).
  // Kohe pärast lähtestust taasta "kleepuv" kärpe-suurus tsentreeritud kastina (kui
  // mõni varem oli) — samas efektis, et boxAngle jääks garanteeritult 0.
  useEffect(() => {
    resetTransforms();
    if (lastCropSizeRef.current) {
      const w = Math.min(Math.max(lastCropSizeRef.current.w, 0.01), 0.98);
      const h = Math.min(Math.max(lastCropSizeRef.current.h, 0.01), 0.98);
      setCropRect({ x: (1 - w) / 2, y: (1 - h) / 2, w, h });
    }
  }, [current?.filename, cacheBust, resetTransforms]);

  // Jäta meelde viimati kasutatud kärpe-suurus. onCropUp viskab MIN_DRAG_PX-st väiksemad
  // kastid ära (cropRect=null) → liiga väikest kogemata kasti ei salvestata.
  useEffect(() => {
    if (cropRect) lastCropSizeRef.current = { w: cropRect.w, h: cropRect.h };
  }, [cropRect]);

  // Mõõda lava tegelik suurus (uueneb akna/modaali muutudes ja tabi vahetusel).
  // Korraga on mountitud ainult ühe tabi lava → re-attach [tab] muutudes.
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
  }, [tab]);

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
  // Ühtne pildi kuva-suurus mõlemal tabil (sõltumatu jämedast pöördest) — split kasutab seda,
  // et edit-tabiga kokku langeda. grossAngle=0 korral identne imgDispW/H-ga.
  const baseFit = Math.min(stage.w / natural.w, stage.h / natural.h, 1);
  const baseDispW = natural.w * baseFit;
  const baseDispH = natural.h * baseFit;

  // --- Kärpe-lohistus (edit-tab) ---
  // clampBounds=true: punkt surutakse pildi raami → kast jääb piiridesse, kursor võib
  // liikuda servast välja. clampBounds=false (pööre): toores punkt, et kursor saaks
  // vabalt ringi liikuda ka raamist väljas.
  const localPoint = (e: { clientX: number; clientY: number }, clampBounds = true) => {
    const rect = overlayRef.current!.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    if (!clampBounds) return { x, y };
    return {
      x: Math.max(0, Math.min(rect.width, x)),
      y: Math.max(0, Math.min(rect.height, y)),
    };
  };

  // cropRect (normaliseeritud, kasti-lokaal) ↔ kese-põhine display-piksli kast
  const rectToCenterPx = (r: CropRect): CenterBox => ({
    cx: (r.x + r.w / 2) * displayW, cy: (r.y + r.h / 2) * displayH,
    w: r.w * displayW, h: r.h * displayH,
  });
  const centerPxToRect = (b: CenterBox): CropRect => ({
    x: (b.cx - b.w / 2) / displayW, y: (b.cy - b.h / 2) / displayH,
    w: b.w / displayW, h: b.h / displayH,
  });
  const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

  const onCropDown = (e: React.MouseEvent) => {
    if (!imgNatural) return;
    e.preventDefault();
    const p = localPoint(e);
    const target = e.target as HTMLElement;

    if (perspective && quad) {
      const ci = target.dataset.corner;
      if (ci !== undefined) {
        interaction.current = { mode: 'corner', idx: Number(ci) };
        setDragging(true);
        return;
      }
      // Perspektiivirežiimis ei joonista uut kasti — ainult nurki lohistab.
      return;
    }

    const handle = target.dataset.handle as CropHandle | undefined;

    if (handle && cropRect) {
      interaction.current = { mode: 'resize', handle, startBox: rectToCenterPx(cropRect) };
    } else if (target.dataset.rotate !== undefined && cropRect) {
      interaction.current = { mode: 'rotate' };
    } else if (target.dataset.cropbox !== undefined && cropRect) {
      const b = rectToCenterPx(cropRect);
      interaction.current = { mode: 'move', startX: p.x, startY: p.y, startCenter: { cx: b.cx, cy: b.cy } };
    } else {
      // Uue kasti joonistus on alati telg-joondatud → nulli kalle
      setBoxAngle(0);
      interaction.current = { mode: 'draw' };
      setCropDraft({ x0: p.x, y0: p.y, x1: p.x, y1: p.y });
    }
    setDragging(true);
  };

  const onCropMove = (e: { clientX: number; clientY: number }) => {
    const it = interaction.current;
    if (!it || (it.mode !== 'draw' && it.mode !== 'corner' && !cropRect)) return;
    const p = localPoint(e);
    if (it.mode === 'corner' && quad) {
      const np = quadPtFromDisplayPx(p.x, p.y, displayW, displayH);
      setQuad(quad.map((q, i) => (i === it.idx ? np : q)) as Quad4);
      return;
    }
    if (it.mode === 'draw') {
      setCropDraft((d) => (d ? { ...d, x1: p.x, y1: p.y } : d));
    } else if (it.mode === 'move' && cropRect) {
      const b = rectToCenterPx(cropRect);
      const cx = clamp(it.startCenter.cx + (p.x - it.startX), 0, displayW);
      const cy = clamp(it.startCenter.cy + (p.y - it.startY), 0, displayH);
      setCropRect(centerPxToRect({ ...b, cx, cy }));
    } else if (it.mode === 'resize') {
      setCropRect(centerPxToRect(resizeRotatedBox(it.startBox, boxAngle, it.handle, p.x, p.y, MIN_DRAG_PX)));
    } else if (it.mode === 'rotate' && cropRect) {
      const b = rectToCenterPx(cropRect);
      // Pööre: toores punkt (clampBounds=false), et kursor saaks vabalt ringi liikuda
      const rp = localPoint(e, false);
      // Kalle nii, et lokaal-üles suund osutab kursorile: atan2(dx, -dy)
      const deg = (Math.atan2(rp.x - b.cx, b.cy - rp.y) * 180) / Math.PI;
      setBoxAngle(deg);
    }
  };

  const onCropUp = () => {
    setDragging(false);
    const it = interaction.current;
    interaction.current = null;
    if (it?.mode === 'draw' && cropDraft) {
      const left = Math.min(cropDraft.x0, cropDraft.x1);
      const top = Math.min(cropDraft.y0, cropDraft.y1);
      const w = Math.abs(cropDraft.x1 - cropDraft.x0);
      const h = Math.abs(cropDraft.y1 - cropDraft.y0);
      setCropDraft(null);
      if (w < MIN_DRAG_PX || h < MIN_DRAG_PX) {
        setCropRect(null);
        return;
      }
      setCropRect({ x: left / displayW, y: top / displayH, w: w / displayW, h: h / displayH });
    }
  };

  // Aktiivse lohistuse ajaks kuula hiirt AKNAST (mitte overlay'lt) — nii ei katke
  // interaktsioon, kui kursor liigub sanga pealt ära või pildi raamist välja.
  // Handlerid loetakse refist, et siduda kuularid vaid korra lohistuse kohta.
  const onCropMoveRef = useRef(onCropMove);
  const onCropUpRef = useRef(onCropUp);
  onCropMoveRef.current = onCropMove;
  onCropUpRef.current = onCropUp;
  useEffect(() => {
    if (!dragging) return;
    const move = (e: MouseEvent) => onCropMoveRef.current(e);
    const up = () => onCropUpRef.current();
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
    return () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
    };
  }, [dragging]);

  // Perspektiivi lüliti: ON → quad olemasolevast kärpest või vaikenelinurk; OFF → quad=null.
  const togglePerspective = () => {
    setPerspective((on) => {
      if (on) { setQuad(null); return false; }
      setQuad(cropRect ? quadFromCropRect(cropRect) : defaultQuad(0.05));
      return true;
    });
  };

  // Jäme 90°/180° pööre rakendub PILDILE; kärbe/kalle lähtestatakse (display-raam muutub).
  // Perspektiivirežiimis lähtestatakse quad vaikenelinurgaks (me ei teisenda nurki).
  const rotateBy = (delta: number) => {
    setGrossAngle((a) => ((a + delta) % 360 + 360) % 360);
    setCropRect(null);
    setCropDraft(null);
    setBoxAngle(0);
    if (perspective) setQuad(defaultQuad(0.05));
    interaction.current = null;
  };

  // --- Hõljuva nupupaneeli lohistus ---
  // Pide haarab paneeli; positsioon arvutatakse lava (stageRef) suhtes ja klambitakse
  // raami sisse. Kuulame AKNAST, et lohistus ei katkeks kursori liikudes paneelilt ära.
  const onToolbarDown = (e: React.MouseEvent) => {
    if (!toolbarRef.current) return;
    e.preventDefault();
    e.stopPropagation();
    const tRect = toolbarRef.current.getBoundingClientRect();
    toolbarGrab.current = { offX: e.clientX - tRect.left, offY: e.clientY - tRect.top };
    setToolbarDragging(true);
  };
  const onToolbarMove = useCallback((e: MouseEvent) => {
    if (!stageRef.current || !toolbarRef.current || !toolbarGrab.current) return;
    const sRect = stageRef.current.getBoundingClientRect();
    const tRect = toolbarRef.current.getBoundingClientRect();
    const x = clamp(e.clientX - sRect.left - toolbarGrab.current.offX, 0, sRect.width - tRect.width);
    const y = clamp(e.clientY - sRect.top - toolbarGrab.current.offY, 0, sRect.height - tRect.height);
    setToolbarPos({ x, y });
  }, []);
  useEffect(() => {
    if (!toolbarDragging) return;
    const move = (e: MouseEvent) => onToolbarMove(e);
    const up = () => { setToolbarDragging(false); toolbarGrab.current = null; };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
    return () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
    };
  }, [toolbarDragging, onToolbarMove]);

  // Kuvatav kärpe-kast: kese, mõõdud, kalle (joonistamise ajal telg-joondatud)
  const cropOverlay: { cx: number; cy: number; w: number; h: number; angle: number } | null = (() => {
    if (cropDraft) {
      return {
        cx: (cropDraft.x0 + cropDraft.x1) / 2,
        cy: (cropDraft.y0 + cropDraft.y1) / 2,
        w: Math.abs(cropDraft.x1 - cropDraft.x0),
        h: Math.abs(cropDraft.y1 - cropDraft.y0),
        angle: 0,
      };
    }
    if (cropRect) {
      const b = rectToCenterPx(cropRect);
      return { cx: b.cx, cy: b.cy, w: b.w, h: b.h, angle: boxAngle };
    }
    return null;
  })();

  // 8 sanga: nurgad + servad. cursor klassiga.
  const CROP_HANDLES: { id: CropHandle; style: React.CSSProperties; cursor: string }[] = [
    { id: 'nw', style: { left: 0, top: 0 }, cursor: 'nwse-resize' },
    { id: 'n', style: { left: '50%', top: 0 }, cursor: 'ns-resize' },
    { id: 'ne', style: { left: '100%', top: 0 }, cursor: 'nesw-resize' },
    { id: 'e', style: { left: '100%', top: '50%' }, cursor: 'ew-resize' },
    { id: 'se', style: { left: '100%', top: '100%' }, cursor: 'nwse-resize' },
    { id: 's', style: { left: '50%', top: '100%' }, cursor: 'ns-resize' },
    { id: 'sw', style: { left: 0, top: '100%' }, cursor: 'nesw-resize' },
    { id: 'w', style: { left: 0, top: '50%' }, cursor: 'ew-resize' },
  ];

  // --- Split-lohistus (split-tab) ---
  const updateSplitX = useCallback((clientX: number) => {
    if (!splitContainerRef.current) return;
    const rect = splitContainerRef.current.getBoundingClientRect();
    const x = (clientX - rect.left) / rect.width;
    setSplitX(Math.max(0.05, Math.min(0.95, x)));
  }, []);

  // Poolitusjoone lohistus: kuula AKNAST, et kursor võiks väljuda pildi raamist
  useEffect(() => {
    if (!splitDragging) return;
    const move = (e: MouseEvent) => updateSplitX(e.clientX);
    const up = () => setSplitDragging(false);
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
    return () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
    };
  }, [splitDragging, updateSplitX]);

  // --- Navigeerimine ---
  const goTo = useCallback((idx: number) => {
    setCurrentIndex(Math.max(0, Math.min(pages.length - 1, idx)));
    setShowConfirm(false);
    setToast(null);
  }, [pages.length]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const tag = (document.activeElement?.tagName || '').toUpperCase();
      const role = (document.activeElement as HTMLElement | null)?.getAttribute('role');
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(tag) || role === 'slider') return;
      if (e.key === 'ArrowLeft') goTo(currentIndex - 1);
      else if (e.key === 'ArrowRight') goTo(currentIndex + 1);
      else if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [currentIndex, goTo, onClose]);

  // --- Rakenda ---
  const doApply = async () => {
    if (!authToken || !current) return;
    setShowConfirm(false);
    setSaving(true);
    setError(null);
    setToast(null);

    const before = pages.map((p) => p.filename);
    const anchor = computeNextAnchor(before, current.filename);
    const currentFilename = current.filename;

    try {
      let thumbWarn = false;
      if (tab === 'edit') {
        if (perspective && quad) {
          // Perspektiiv: jäme pööre + quad (deskew boxAngle EI kasutata).
          const r = await transformPageImage(workId, currentFilename, grossAngle, null, authToken, quad);
          thumbWarn = !!r.thumbnail_warning;
        } else {
          // Jäme pööre + kasti-kalle → serveri (angle, telg-joondatud crop).
          let sendAngle = grossAngle;
          let sendCrop: CropRect | null = null;
          if (cropRect) {
            const b = rectToCenterPx(cropRect);
            const params = rotatedCropToServerParams(
              { cx: b.cx, cy: b.cy, w: b.w, h: b.h, angleDeg: boxAngle }, displayW, displayH,
            );
            sendAngle = ((grossAngle + params.angle) % 360 + 360) % 360;
            // Klampi normaliseeritud kärbe [0,1] sisse (kaitse servast väljaulatuva kasti eest)
            const x = clamp(params.crop.x, 0, 1);
            const y = clamp(params.crop.y, 0, 1);
            sendCrop = { x, y, w: clamp(params.crop.w, 0, 1 - x), h: clamp(params.crop.h, 0, 1 - y) };
          }
          const r = await transformPageImage(workId, currentFilename, sendAngle, sendCrop, authToken);
          thumbWarn = !!r.thumbnail_warning;
        }
      } else {
        const res = await fetchWithTimeout(
          `${FILE_API_URL}/admin/work/${workId}/page/${current.page_num}/split`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...getAuthHeaders(authToken) },
            body: JSON.stringify({ split_x: splitX }),
            timeout: 30000,
          },
        );
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.detail || `HTTP ${res.status}`);
        }
      }

      const after = await onPagesChanged();
      const { index, done } = resolveIndexAfter(after, anchor, currentFilename);
      setCurrentIndex(index);
      setSaving(false);

      if (tab === 'split') {
        // Uued pooled = failid, mida enne polnud
        const newHalves = after.filter((f) => !before.includes(f));
        const firstHalfIdx = newHalves.length > 0 ? after.indexOf(newHalves[0]) : -1;
        setToast({
          text: t('manage.editor.splitDone'),
          action: firstHalfIdx >= 0
            ? { label: t('manage.editor.viewNewHalves'), run: () => goTo(firstHalfIdx) }
            : undefined,
        });
      } else if (done) {
        setToast({ text: t('manage.editor.allDone') });
      } else if (thumbWarn) {
        setToast({ text: t('manage.editor.thumbWarning') });
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : t('manage.editor.applyError'));
      setSaving(false);
    }
  };

  const onApplyClick = () => {
    if (skipConfirm) {
      doApply();
    } else {
      setShowConfirm(true);
    }
  };

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
      await onReplaceImage(file, current.page_num);
      // cacheBust uueneb parent'is (thumbCacheBust) → reset-effekt mõõdab pildi uuesti ja lähtestab teisendused
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : t('manage.replaceError'));
    } finally {
      setReplacing(false);
    }
  };

  if (!current) return null;

  const noEditChange = tab === 'edit' && grossAngle === 0 && cropRect === null && !(perspective && quad);

  // Laadija täidab lava — kuvame kuni naturaalmõõdud teada (väldib aspect-venitust).
  const loadingBox = (
    <div className="flex items-center justify-center bg-white shadow-inner border border-gray-200 w-full h-full">
      <Loader2 size={28} className="animate-spin text-gray-300" />
    </div>
  );

  return (
    <div className="fixed inset-0 bg-black/60 z-[1300] flex items-center justify-center p-4">
      {/* Kindel kõrgus (mitte ainult max-h): flex-1 "lava" vajab jaotamiseks definiitset
          kõrgust, muidu kahaneb 0-ks ja pilt ei mahu. */}
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-3xl flex flex-col h-[92vh] max-h-[92vh]">

        {/* Päis */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-gray-100 flex-shrink-0">
          <div className="flex items-center gap-3">
            <Crop size={18} className="text-indigo-600" />
            <h2 className="font-semibold text-gray-900">{t('manage.editor.title')}</h2>
            <span className="text-sm text-gray-400">
              {t('manage.editor.page', { cur: safeIndex + 1, total: pages.length })}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowRestoreConfirm(true)}
              disabled={restoring || saving || replacing}
              title={t('manage.editor.restoreOriginal')}
              className="flex items-center gap-1.5 px-2 py-1 text-xs text-gray-600 border border-gray-300 rounded hover:bg-gray-100 disabled:opacity-50 transition-colors"
            >
              {restoring ? <Loader2 size={13} className="animate-spin" /> : <Undo2 size={13} />}
              {t('manage.editor.restoreOriginal')}
            </button>
            {/* Asenda pilt (harv: parema kvaliteediga skann) */}
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
              onClick={() => replaceInputRef.current?.click()}
              disabled={replacing || saving}
              title={t('manage.replaceImage')}
              className="flex items-center gap-1.5 px-2 py-1 text-xs text-gray-600 border border-gray-300 rounded hover:bg-gray-100 disabled:opacity-50 transition-colors"
            >
              {replacing ? <Loader2 size={13} className="animate-spin" /> : <Upload size={13} />}
              {t('manage.replaceImage')}
            </button>
            <button onClick={onClose} className="text-gray-400 hover:text-gray-600 transition-colors" aria-label={t('manage.editor.close')}>
              <X size={20} />
            </button>
          </div>
        </div>

        {/* Tabid */}
        <div className="flex gap-1 px-5 pt-3 flex-shrink-0">
          <button
            onClick={() => { setTab('edit'); setError(null); }}
            className={`px-3 py-1.5 text-sm rounded-t-md border-b-2 transition-colors ${tab === 'edit' ? 'border-indigo-600 text-indigo-700 font-medium' : 'border-transparent text-gray-500 hover:text-gray-700'}`}
          >
            {t('manage.editor.tabEdit')}
          </button>
          <button
            onClick={() => { setTab('split'); setError(null); }}
            className={`px-3 py-1.5 text-sm rounded-t-md border-b-2 transition-colors ${tab === 'split' ? 'border-indigo-600 text-indigo-700 font-medium' : 'border-transparent text-gray-500 hover:text-gray-700'}`}
          >
            {t('manage.editor.tabSplit')}
          </button>
        </div>

        {/* Sisu */}
        <div className="flex-1 min-h-0 overflow-hidden p-4 bg-gray-50 flex flex-col">
          {/* Peidetud laadija: mõõdab pildi naturaalmõõdud enne kuvamist (väldib aspect-venitust) */}
          {!imgNatural && (
            <img
              src={imageUrl}
              alt=""
              draggable={false}
              className="hidden"
              onLoad={(e) => setImgNatural({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })}
            />
          )}
          {tab === 'edit' ? (
            <div className="flex flex-col items-center gap-2 h-full min-h-0 w-full">
              <p className="text-xs text-gray-400 flex-shrink-0">
                {perspective ? t('manage.editor.perspectiveHint') : t('manage.editor.cropHint')}
              </p>

              {/* Lava: mõõdetav paindlik ala, kuhu eelvaade mahutatakse. Pööramisnupud
                  hõljuvad pildi peal (absolute) → ei söö ei kõrgust ega laiust, pilt saab
                  kogu ruumi (sama suurus ka split-tabil). */}
              <div ref={stageRef} className="relative flex-1 min-h-0 w-full flex items-center justify-center overflow-hidden">
                {/* Eelvaade: pilt seisab (jäme pööre), kärpe-kasti saab kallutada */}
                {!imgNatural ? loadingBox : (
              <div
                className="relative bg-white shadow-inner border border-gray-200"
                style={{ width: displayW, height: displayH }}
              >
                <img
                  src={imageUrl}
                  alt={current.filename}
                  draggable={false}
                  className="absolute pointer-events-none select-none"
                  style={{
                    width: imgDispW,
                    height: imgDispH,
                    left: '50%', top: '50%',
                    transform: `translate(-50%, -50%) rotate(${grossAngle}deg)`,
                  }}
                />
                {/* Kärpe-overlay (püüab hiire) */}
                <div
                  ref={overlayRef}
                  className="absolute inset-0 cursor-crosshair"
                  onMouseDown={onCropDown}
                >
                  {perspective && quad ? (
                    <svg
                      className="absolute inset-0 w-full h-full overflow-visible"
                      style={{ pointerEvents: 'none' }}
                    >
                      <polygon
                        points={quadToDisplayPx(quad, displayW, displayH).map((p) => `${p.x},${p.y}`).join(' ')}
                        fill="rgba(99,102,241,0.15)"
                        stroke="rgb(99,102,241)"
                        strokeWidth={2}
                      />
                      {quadToDisplayPx(quad, displayW, displayH).map((p, i) => (
                        <circle
                          key={i}
                          data-corner={i}
                          cx={p.x}
                          cy={p.y}
                          r={7}
                          fill="white"
                          stroke="rgb(99,102,241)"
                          strokeWidth={2}
                          style={{ pointerEvents: 'auto', cursor: 'grab' }}
                        />
                      ))}
                    </svg>
                  ) : cropOverlay && (
                    <div
                      data-cropbox=""
                      className="absolute border-2 border-indigo-500"
                      style={{
                        left: cropOverlay.cx - cropOverlay.w / 2,
                        top: cropOverlay.cy - cropOverlay.h / 2,
                        width: cropOverlay.w,
                        height: cropOverlay.h,
                        transform: `rotate(${cropOverlay.angle}deg)`,
                        transformOrigin: 'center',
                        boxShadow: '0 0 0 9999px rgba(0,0,0,0.35)',
                        cursor: 'move',
                      }}
                    >
                      {/* Resize-sangad + pöördesang (ainult kinnitatud kastil) */}
                      {!cropDraft && (
                        <>
                          {CROP_HANDLES.map((hh) => (
                            <div
                              key={hh.id}
                              data-handle={hh.id}
                              className="absolute w-2.5 h-2.5 bg-white border border-indigo-600 rounded-sm"
                              style={{ ...hh.style, transform: 'translate(-50%, -50%)', cursor: hh.cursor }}
                            />
                          ))}
                          {/* Pöördesang ülal keskel */}
                          <div
                            className="absolute w-px bg-indigo-500 pointer-events-none"
                            style={{ left: '50%', top: -22, height: 22 }}
                          />
                          <div
                            data-rotate=""
                            title={t('manage.editor.deskew')}
                            className="absolute w-3 h-3 bg-white border border-indigo-600 rounded-full"
                            style={{ left: '50%', top: -22, transform: 'translate(-50%, -50%)', cursor: 'grab' }}
                          />
                        </>
                      )}
                    </div>
                  )}
                </div>
              </div>
              )}

                {/* Tööriistad: pööramine hõljub pildi peal, vabalt lohistatav (vaikimisi parem ülanurk) */}
                <div
                  ref={toolbarRef}
                  className="absolute z-20 flex flex-col items-center gap-2 p-1.5 rounded-lg bg-white/80 backdrop-blur-sm shadow-md border border-gray-200"
                  style={toolbarPos ? { left: toolbarPos.x, top: toolbarPos.y } : { top: 8, right: 8 }}
                >
                  {/* Lohistuspide */}
                  <div
                    onMouseDown={onToolbarDown}
                    title={t('manage.editor.dragPanel')}
                    className={`w-full flex items-center justify-center text-gray-400 hover:text-gray-600 ${toolbarDragging ? 'cursor-grabbing' : 'cursor-grab'}`}
                  >
                    <GripHorizontal size={14} />
                  </div>
                  <button onClick={() => rotateBy(-90)} title={t('manage.editor.rotateLeft')} className="p-2 rounded border border-gray-300 bg-white hover:bg-gray-100">
                    <RotateCcw size={16} />
                  </button>
                  <button onClick={() => rotateBy(90)} title={t('manage.editor.rotateRight')} className="p-2 rounded border border-gray-300 bg-white hover:bg-gray-100">
                    <RotateCw size={16} />
                  </button>
                  <button onClick={() => rotateBy(180)} title={t('manage.editor.rotate180')} className="p-2 rounded border border-gray-300 bg-white hover:bg-gray-100">
                    <FlipVertical2 size={16} />
                  </button>
                  <button
                    onClick={togglePerspective}
                    title={t('manage.editor.perspective')}
                    className={`p-2 rounded border ${perspective ? 'border-indigo-600 bg-indigo-50 text-indigo-700' : 'border-gray-300 bg-white hover:bg-gray-100'}`}
                  >
                    <Frame size={16} />
                  </button>
                  {cropRect && !perspective && (
                    <button onClick={() => { setCropRect(null); setBoxAngle(0); lastCropSizeRef.current = null; }} title={t('manage.editor.cropReset')} className="p-2 rounded border border-gray-300 bg-white hover:bg-gray-100 text-gray-500 hover:text-gray-700">
                      <CircleX size={16} />
                    </button>
                  )}
                  {cropRect && !perspective && Math.abs(boxAngle) > 0.05 && (
                    <span title={t('manage.editor.deskew')} className="text-xs text-gray-600 tabular-nums text-center">
                      {boxAngle.toFixed(1)}°
                    </span>
                  )}
                </div>
              </div>
            </div>
          ) : (
            <div className="flex flex-col items-center h-full min-h-0 w-full">
              <p className="text-sm text-gray-500 mb-3 self-start flex-shrink-0">
                {t('manage.editor.tabSplit')} — <span className="font-medium text-gray-700">{Math.round(splitX * 100)}%</span>
              </p>
              {/* Lava: sama mõõdetav ala ka poolitamise tabil */}
              <div ref={stageRef} className="flex-1 min-h-0 w-full flex items-center justify-center overflow-hidden">
              {!imgNatural ? loadingBox : (
              <div
                ref={splitContainerRef}
                className="relative select-none cursor-col-resize overflow-hidden rounded border border-gray-200"
                style={{ width: baseDispW, height: baseDispH }}
              >
                <img
                  src={imageUrl}
                  alt={current.filename}
                  className="block pointer-events-none"
                  draggable={false}
                  style={{ width: baseDispW, height: baseDispH }}
                />
                <div className="absolute top-0 bottom-0 w-0.5 bg-red-500 opacity-90 pointer-events-none" style={{ left: `${splitX * 100}%` }} />
                <div
                  className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-5 h-10 bg-red-500 rounded cursor-col-resize flex items-center justify-center shadow-md"
                  style={{ left: `${splitX * 100}%` }}
                  onMouseDown={(e) => { e.preventDefault(); setSplitDragging(true); }}
                >
                  <div className="w-0.5 h-6 bg-white/70 mx-0.5" />
                  <div className="w-0.5 h-6 bg-white/70 mx-0.5" />
                </div>
              </div>
              )}
              </div>
            </div>
          )}
        </div>

        {/* Jalus */}
        <div className="px-5 py-3 border-t border-gray-100 flex-shrink-0 space-y-3">
          {error && (
            <div className="flex items-center gap-2 p-3 bg-red-50 border border-red-200 rounded text-sm text-red-700">
              <AlertTriangle size={14} /> {error}
            </div>
          )}
          {toast && (
            <div className="flex items-center justify-between gap-2 p-3 bg-emerald-50 border border-emerald-200 rounded text-sm text-emerald-800">
              <span className="flex items-center gap-2"><Check size={14} /> {toast.text}</span>
              {toast.action && (
                <button onClick={toast.action.run} className="text-emerald-700 underline hover:text-emerald-900 font-medium">
                  {toast.action.label}
                </button>
              )}
            </div>
          )}

          {showConfirm && (
            <div className="p-3 bg-amber-50 border border-amber-200 rounded space-y-2">
              <p className="text-sm text-amber-800">{t('manage.editor.confirmBody')}</p>
              <label className="flex items-center gap-2 text-sm text-amber-700">
                <input type="checkbox" checked={skipConfirm} onChange={(e) => setSkipConfirm(e.target.checked)} />
                {t('manage.editor.dontAskAgain')}
              </label>
            </div>
          )}

          {showRestoreConfirm && (
            <div className="p-3 bg-amber-50 border border-amber-200 rounded space-y-2">
              <p className="text-sm text-amber-800">{t('manage.editor.restoreConfirmBody')}</p>
              <div className="flex gap-2">
                <button
                  onClick={doRestoreOriginal}
                  className="px-3 py-1 text-sm bg-amber-600 hover:bg-amber-700 text-white rounded"
                >
                  {t('manage.editor.restoreOriginal')}
                </button>
                <button
                  onClick={() => setShowRestoreConfirm(false)}
                  className="px-3 py-1 text-sm border border-gray-300 rounded hover:bg-gray-100"
                >
                  {t('manage.editor.cancel')}
                </button>
              </div>
            </div>
          )}

          <div className="flex items-center justify-between">
            {/* Navigeerimine */}
            <div className="flex items-center gap-1">
              <button
                onClick={() => goTo(currentIndex - 1)}
                disabled={safeIndex <= 0 || saving}
                title={t('manage.editor.prev')}
                className="p-2 rounded border border-gray-300 bg-white hover:bg-gray-100 disabled:opacity-40"
              >
                <ChevronLeft size={16} />
              </button>
              <button
                onClick={() => goTo(currentIndex + 1)}
                disabled={safeIndex >= pages.length - 1 || saving}
                title={t('manage.editor.next')}
                className="p-2 rounded border border-gray-300 bg-white hover:bg-gray-100 disabled:opacity-40"
              >
                <ChevronRight size={16} />
              </button>
            </div>

            {/* Rakenda */}
            <button
              onClick={showConfirm ? doApply : onApplyClick}
              disabled={saving || (tab === 'edit' && noEditChange)}
              className="flex items-center gap-2 px-5 py-2 text-sm bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white rounded transition-colors"
            >
              {saving ? <Loader2 size={14} className="animate-spin" /> : (tab === 'split' ? <Scissors size={14} /> : <Check size={14} />)}
              {t('manage.editor.apply')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default PageImageEditorModal;
