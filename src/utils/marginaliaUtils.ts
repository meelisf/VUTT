// src/utils/marginaliaUtils.ts
// Marginaalia plokkide leidmine ja virnastamine — puhtad funktsioonid.
// Kasutavad: MarginaliaExtension (editor). Vt spec:
// docs/superpowers/specs/2026-06-11-marginalia-display-design.md

export interface MarginaliaBlock {
  /** '<m>' tägi algus */
  from: number;
  /** '</m>' tägi lõpp */
  to: number;
  /** Sisu vahemik tägide vahel */
  contentFrom: number;
  contentTo: number;
  /** Peidetav ala: ploki read koos ühe reavahetusega (lõpus või, dokumendi lõpus, ees) */
  hideFrom: number;
  hideTo: number;
  /** Ankrurea algus — rida, mille kõrval plokk veerus seisab */
  anchorPos: number;
}

const M_BLOCK_RE = /<m>([\s\S]*?)<\/m>/g;

/**
 * Leiab marginaalia plokid, mis seisavad omaette ridadel (rea alguses algav <m>,
 * rea lõpus lõppev </m>; servades lubatud ainult tühikud). Rea keskel olevad
 * <m> tägid jäetakse vahele — need renderduvad edasi tavalise inline-margina.
 * Ankrureegel: plokk kuulub JÄRGMISE rea juurde; dokumendi lõpus eelmise rea juurde.
 */
export function findMarginaliaBlocks(text: string): MarginaliaBlock[] {
  const blocks: MarginaliaBlock[] = [];
  M_BLOCK_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = M_BLOCK_RE.exec(text)) !== null) {
    const from = m.index;
    const to = from + m[0].length;

    const lineStart = text.lastIndexOf('\n', from - 1) + 1;
    if (text.slice(lineStart, from).trim() !== '') continue;
    let lineEnd = text.indexOf('\n', to);
    if (lineEnd === -1) lineEnd = text.length;
    if (text.slice(to, lineEnd).trim() !== '') continue;

    let hideFrom = lineStart;
    let hideTo: number;
    let anchorPos: number;
    if (lineEnd < text.length) {
      hideTo = lineEnd + 1;            // koos lõpu reavahetusega
      anchorPos = lineEnd + 1;         // järgmise rea algus
    } else {
      // Dokumendi lõpus: võtame eelneva reavahetuse ja ankurdame eelmise rea külge
      hideFrom = lineStart > 0 ? lineStart - 1 : 0;
      hideTo = lineEnd;
      anchorPos = lineStart > 0 ? text.lastIndexOf('\n', lineStart - 2) + 1 : 0;
    }
    blocks.push({ from, to, contentFrom: from + 3, contentTo: to - 4, hideFrom, hideTo, anchorPos });
  }

  // Dokumendi lõpus laenab viimane plokk eelneva reavahetuse — see võib kattuda
  // eelmise ploki peitealaga. Kattuvad block-replace dekoratsioonid viskaksid
  // CM6-s erandi, seega lõikame kattuvuse ära.
  for (let i = 1; i < blocks.length; i++) {
    if (blocks[i].hideFrom < blocks[i - 1].hideTo) blocks[i].hideFrom = blocks[i - 1].hideTo;
  }

  // Kui ankur satub teise peidetud ploki sisse (järjestikused plokid),
  // liigu edasi kuni esimese nähtava positsioonini.
  for (const b of blocks) {
    let moved = true;
    while (moved) {
      moved = false;
      for (const other of blocks) {
        if (other !== b && b.anchorPos >= other.hideFrom && b.anchorPos < other.hideTo) {
          b.anchorPos = other.hideTo;
          moved = true;
        }
      }
    }
  }
  return blocks;
}

export interface StackInput {
  /** Ploki loomulik ülaserv (= ankrurea ülaserv), px */
  anchorTop: number;
  height: number;
}
export interface StackedPos {
  top: number;
  /** Nihe loomulikust kohast allapoole; > 0 → vaja konnektorit */
  offset: number;
}

/**
 * Virnastab marginaalia plokid: iga plokk algab oma ankru kõrguselt, aga mitte
 * eelmise ploki peal. Sisend PEAB olema anchorTop järgi kasvavalt sorteeritud.
 */
export function stackMarginalia(items: StackInput[], gap = 6): StackedPos[] {
  const out: StackedPos[] = [];
  let bottom = -Infinity;
  for (const it of items) {
    const top = Math.max(it.anchorTop, bottom + gap);
    out.push({ top, offset: top - it.anchorTop });
    bottom = top + it.height;
  }
  return out;
}

export interface CleanChangeSpec {
  from: number;
  to: number;
  insert: string;
}

/**
 * Ehitab cleanMarkup'i muudatused valikule nii, et peidetud marginaalia plokid
 * jäävad dokumendis täpselt oma kohale: iga nähtava segmendi kohta eraldi
 * muudatus, peidetud vahemikke EI puudutata. (Üksiku tervet valikut katva
 * muudatuse korral kirjutaks kaitsefilter tehingu ümber ja plokk nihkuks
 * valiku lõppu keset rida — kaotaks ankru ja degradeeruks inline-margiks.)
 *
 * `hidden` peab olema kasvavalt sorteeritud ja mittekattuv (hiddenBlockRanges).
 */
export function cleanMarkupSpecs(
  doc: string,
  from: number,
  to: number,
  hidden: { from: number; to: number }[],
  clean: (s: string) => string,
): CleanChangeSpec[] {
  const specs: CleanChangeSpec[] = [];
  const pushSegment = (segFrom: number, segTo: number) => {
    if (segTo <= segFrom) return;
    specs.push({ from: segFrom, to: segTo, insert: clean(doc.slice(segFrom, segTo)) });
  };
  let cursor = from;
  for (const h of hidden) {
    if (h.to <= from || h.from >= to) continue;
    pushSegment(cursor, Math.max(cursor, Math.min(h.from, to)));
    cursor = Math.max(cursor, Math.min(h.to, to));
  }
  pushSegment(cursor, to);
  return specs;
}
