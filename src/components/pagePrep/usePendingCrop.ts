import { useEffect, useRef } from 'react';
import { adjustFromParams } from '../../pages/upload/prepressPlan';
import type { PageAdjust } from '../../pages/upload/types';
import type { CropBoxState } from './useCropBox';

interface Args {
  crop: CropBoxState;
  /** Lehe ootel kärbe plaanist. */
  pendingAdjust: PageAdjust | null;
  /**
   * Lehe võti (leht + pööre + pildi versioon). Taastamine käib üks kord võtme kohta;
   * pärast seda on kast ise tõeallikas ja plaan järgib teda.
   */
  pageKey: string;
  /** Kuvamõõdud kuuluvad SELLELE võtmele (mitte eelmise lehe pildile). */
  ready: boolean;
  /** Kirjuta lehe kärbe plaani (`null` = kärbet pole). */
  onCommit: (adjust: PageAdjust | null) => void;
}

const sameAdjust = (a: PageAdjust | null, b: PageAdjust | null) =>
  JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/**
 * „Kõik on kohe ootel" (ADR 0085), kärpe pool — ÜHINE mõlemale pildiredaktorile:
 *
 * 1. Lehele tulles taastatakse ootel kärbe MUUDETAVA kastina (ekraanil olev kast =
 *    ootel kärbe). Taastamine ei ole kasutaja muudatus ega pakkumine.
 * 2. Iga lõpetatud kasutaja muudatus (`crop.editSeq`) läheb kohe plaani. Kleepuv kast
 *    on PAKKUMINE ja plaani EI lähe, kuni kasutaja teda puudutab või põhinupuga vastu
 *    võtab — muidu kärbiks iga läbi lehitsetud lehte (2026-11-17).
 */
export function usePendingCrop({ crop, pendingAdjust, pageKey, ready, onCommit }: Args) {
  const restoredFor = useRef<string | null>(null);
  const pendingRef = useRef(pendingAdjust);
  pendingRef.current = pendingAdjust;
  const { restore } = crop;

  useEffect(() => {
    if (!ready || restoredFor.current === pageKey) return;
    restoredFor.current = pageKey;
    if (pendingRef.current) restore(pendingRef.current);
  }, [ready, pageKey, restore]);

  const lastSeq = useRef(crop.editSeq);
  const onCommitRef = useRef(onCommit);
  onCommitRef.current = onCommit;
  const { editSeq, dragging, userEdited, proposal, toServerParams } = crop;
  useEffect(() => {
    if (editSeq === lastSeq.current || dragging) return;
    lastSeq.current = editSeq;
    if (proposal) return;   // puutumata pakkumine — plaani ei puuduta
    const desired = userEdited ? adjustFromParams(toServerParams(0)) : null;
    if (sameAdjust(desired, pendingRef.current)) return;
    onCommitRef.current(desired);
    // toServerParams on iga renderi uus funktsioon → effect jookseb igal renderil, aga
    // töö teeb ainult siis, kui loendur muutus (varajane return ülal).
  }, [editSeq, dragging, userEdited, proposal, toServerParams]);
}
