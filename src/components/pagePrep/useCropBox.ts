import { useCallback, useEffect, useRef, useState } from 'react';
import type { CropRect } from '../../services/pageService';
import { resizeRotatedBox, CropHandle, CenterBox } from '../../utils/cropBoxInteraction';
import { rotatedCropToServerParams } from '../../utils/rotatedCropParams';
import { defaultQuad, quadFromCropRect, quadPtFromDisplayPx, Quad4 } from '../../utils/perspectiveQuad';
import { addRotation } from './geometry';

const MIN_DRAG_PX = 8;   // alla selle ei registreeri kärbet

/** Serveri teisendusparameetrid — sama leping teose halduses ja upload'i plaanis. */
export interface CropServerParams {
  angle: number;
  crop: CropRect | null;
  quad: Quad4 | null;
}

type Interaction =
  | { mode: 'draw' }
  | { mode: 'move'; startX: number; startY: number; startCenter: { cx: number; cy: number } }
  | { mode: 'resize'; handle: CropHandle; startBox: CenterBox }
  | { mode: 'rotate' }
  | { mode: 'corner'; idx: number }
  | null;

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/**
 * Kärpekasti, kalde (deskew) ja perspektiivi interaktsioon. Üks tee teose
 * halduse pildiredaktorile ja upload'i ülevaatusele (#431).
 *
 * `displayW/H` on overlay kuvamõõdud pikslites — see ala, mille peale kast
 * joonistatakse (teose halduses jämeda pöörde laiendatud kast, upload'is
 * juba pööratud eelvaade). `active` = pildi mõõdud on teada.
 */
export function useCropBox(displayW: number, displayH: number, active: boolean) {
  const [boxAngle, setBoxAngle] = useState(0);        // crop-kasti kalle (deskew)
  const [cropRect, setCropRect] = useState<CropRect | null>(null);  // telg-joondatud kasti-lokaal
  const [perspective, setPerspective] = useState(false);   // perspektiivirežiim
  const [quad, setQuad] = useState<Quad4 | null>(null);     // 4 nurka [0..1]
  const [dragging, setDragging] = useState(false);          // kärbe-interaktsioon aktiivne
  // Kärpe-lohistuse ajutine olek (display-pikslites)
  const [cropDraft, setCropDraft] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  // "Kleepuv" kärpe-suurus: viimati kasutatud kasti normaliseeritud mõõt. Iga uue lehe
  // avamisel ilmub sama suur tühi kast keskele (asukohta/kallet ei taastata). Ref, mitte
  // state → ei tekita re-render'it ega püsi üle komponendi elu. clearCrop nullib selle.
  const lastCropSizeRef = useRef<{ w: number; h: number } | null>(null);
  const interaction = useRef<Interaction>(null);
  const overlayRef = useRef<HTMLDivElement>(null);

  // Jäta meelde viimati kasutatud kärpe-suurus. onCropUp viskab MIN_DRAG_PX-st väiksemad
  // kastid ära (cropRect=null) → liiga väikest kogemata kasti ei salvestata.
  useEffect(() => {
    if (cropRect) lastCropSizeRef.current = { w: cropRect.w, h: cropRect.h };
  }, [cropRect]);

  /** Lähtesta leheks: kõik tühjaks, siis "kleepuv" suurus tsentreeritud kastina. */
  const reset = useCallback(() => {
    setBoxAngle(0);
    setCropDraft(null);
    setPerspective(false);
    setQuad(null);
    interaction.current = null;
    if (lastCropSizeRef.current) {
      const w = Math.min(Math.max(lastCropSizeRef.current.w, 0.01), 0.98);
      const h = Math.min(Math.max(lastCropSizeRef.current.h, 0.01), 0.98);
      setCropRect({ x: (1 - w) / 2, y: (1 - h) / 2, w, h });
    } else {
      setCropRect(null);
    }
  }, []);

  /** Eemalda kast JA unusta kleepuv suurus. */
  const clearCrop = useCallback(() => {
    setCropRect(null);
    setBoxAngle(0);
    lastCropSizeRef.current = null;
  }, []);

  // --- Kärpe-lohistus ---
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

  const onMouseDown = (e: React.MouseEvent) => {
    if (!active) return;
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

  const resetQuad = () => setQuad(defaultQuad(0.05));

  /** Jäme pööre muudab kuvaraami → kärbe/kalle lähtestatakse; perspektiivis
   *  lähtestatakse quad vaikenelinurgaks (nurki me ei teisenda). */
  const onGrossRotate = () => {
    setCropRect(null);
    setCropDraft(null);
    setBoxAngle(0);
    if (perspective) setQuad(defaultQuad(0.05));
    interaction.current = null;
  };

  // Kuvatav kärpe-kast: kese, mõõdud, kalle (joonistamise ajal telg-joondatud)
  const overlayBox: { cx: number; cy: number; w: number; h: number; angle: number } | null = (() => {
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

  /** Kas kasutajal on midagi rakendada (kast või perspektiiv). */
  const hasEdit = cropRect !== null || (perspective && quad !== null);

  /**
   * Serveri parameetrid. `grossAngle` = pildile rakendatud jäme pööre (upload'is 0,
   * sest eelvaade on juba pööratud). Perspektiivis kasti kallet EI kasutata.
   */
  const toServerParams = (grossAngle: number): CropServerParams => {
    if (perspective && quad) return { angle: grossAngle, crop: null, quad };
    if (!cropRect) return { angle: grossAngle, crop: null, quad: null };
    // Jäme pööre + kasti-kalle → serveri (angle, telg-joondatud crop).
    const b = rectToCenterPx(cropRect);
    const params = rotatedCropToServerParams(
      { cx: b.cx, cy: b.cy, w: b.w, h: b.h, angleDeg: boxAngle }, displayW, displayH,
    );
    // Klampi normaliseeritud kärbe [0,1] sisse (kaitse servast väljaulatuva kasti eest)
    const x = clamp(params.crop.x, 0, 1);
    const y = clamp(params.crop.y, 0, 1);
    return {
      angle: addRotation(grossAngle, params.angle),
      crop: { x, y, w: clamp(params.crop.w, 0, 1 - x), h: clamp(params.crop.h, 0, 1 - y) },
      quad: null,
    };
  };

  return {
    overlayRef, cropRect, boxAngle, quad, perspective, cropDraft, overlayBox, hasEdit,
    displayW, displayH,
    onMouseDown, reset, clearCrop, togglePerspective, resetQuad, onGrossRotate, toServerParams,
  };
}

export type CropBoxState = ReturnType<typeof useCropBox>;
