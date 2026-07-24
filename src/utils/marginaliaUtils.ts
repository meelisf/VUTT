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
        if (b.anchorPos >= other.hideFrom && b.anchorPos < other.hideTo) {
          b.anchorPos = other.hideTo;
          moved = true;
        }
      }
    }
    // Dokumendi lõpus olev klaster: edasi-nihutus jõuab doc lõppu, kus widget
    // on block-replace piiril ega renderdu. Ankurda TAGASI — klastri-eelse
    // nähtava rea algusesse (klastri algus = kontiguaalsete peitealade esimene).
    if (b.anchorPos >= text.length) {
      let clusterStart = text.length;
      let shrunk = true;
      while (shrunk) {
        shrunk = false;
        for (const other of blocks) {
          if (other.hideTo === clusterStart) { clusterStart = other.hideFrom; shrunk = true; }
        }
      }
      if (clusterStart < text.length) {
        b.anchorPos = clusterStart > 0 ? text.lastIndexOf('\n', clusterStart - 2) + 1 : 0;
      }
    }
  }
  return blocks;
}

/**
 * Üks visuaalne ääremärkus, mis koosneb ühest või mitmest järjestikusest `<m>`
 * plokist. OCR lõhub pika ääremärkuse mitmeks `<m>` reaks (üks füüsiline rida =
 * üks `<m>`); siin liidame järjestikused plokid tagasi ÜHEKS kaardiks.
 *
 * Grupeerimine toimub RENDERDUSE tasandil (overlay + dekoratsioonid), parser
 * (`findMarginaliaBlocks`) jääb per-`<m>` puhtaks. Vt plaani Task 3.
 */
export interface MarginaliaGroup {
  /** Grupi liikme-plokid dokumendi järjekorras */
  blocks: MarginaliaBlock[];
  /** Esimese ploki `from` — grupi identifikaator (dataset.mFrom) */
  from: number;
  /** Peidetav ala: esimese ploki hideFrom kuni viimase ploki hideTo (pidev) */
  hideFrom: number;
  hideTo: number;
  /** Jagatud ankrurea positsioon */
  anchorPos: number;
}

/**
 * Liidab järjestikused plokid gruppideks. Kaks plokki on samas grupis, kui nende
 * peidetavad alad on PIDEVAD (`b.hideFrom === eelmise.hideTo`) JA neil on sama
 * ankur. `findMarginaliaBlocks` tagab juba, et klastri liikmete hideFrom/hideTo
 * on pidevad ja ankrud võrdsed.
 */
export function groupMarginaliaBlocks(blocks: MarginaliaBlock[]): MarginaliaGroup[] {
  const groups: MarginaliaGroup[] = [];
  for (const b of blocks) {
    const last = groups[groups.length - 1];
    if (last && b.hideFrom === last.hideTo && b.anchorPos === last.anchorPos) {
      last.blocks.push(b);
      last.hideTo = b.hideTo;
    } else {
      groups.push({ blocks: [b], from: b.from, hideFrom: b.hideFrom, hideTo: b.hideTo, anchorPos: b.anchorPos });
    }
  }
  return groups;
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

export interface MarginaliaFromSelection {
  changes: CleanChangeSpec[];
  /** Kõigi loodud plokkide sisupositsioonid UUE dokumendi koordinaatides. */
  openPositions: number[];
  /** Kursori positsioon UUE dokumendi koordinaatides (viimase ploki sisu lõpp). */
  cursor: number;
}

/**
 * Kas vahemik puudutab mõnda avatud marginaaliaplokki. Tühja vahemiku puhul
 * kontrollitakse kursori asukohta. Kasutab editori toiming, et `<m>` sisse ei
 * saaks Marginalia-nupuga uut `<m>` plokki tekitada.
 */
export function rangeTouchesOpenMarginalia(
  blocks: MarginaliaBlock[],
  openMarks: number[],
  from: number,
  to: number,
): boolean {
  return groupMarginaliaBlocks(blocks).some(group => {
    const open = group.blocks.some(block =>
      openMarks.some(p => p >= block.from && p <= block.to));
    if (!open) return false;
    return group.blocks.some(block => from === to
      ? from >= block.from && from <= block.to
      : from < block.to && to > block.from);
  });
}

/**
 * Iga füüsiline marginaaliarida saab oma `<m>…</m>` paari. Üle reavahetuse
 * ulatuvad inline-tägid suletakse rea lõpus ja avatakse järgmisel real uuesti,
 * et rea-põhine `<m>` ei tekitaks ristuvat kuju `<m><i>X</m>…`.
 */
function wrapMarginaliaLines(text: string): string {
  const active: string[] = [];
  const inlineTagRe = /<(\/?)((?:i|b|cs|hi)|(?:ann\d*))>/g;
  return text.split('\n').map(line => {
    const inherited = active.map(name => `<${name}>`).join('');
    inlineTagRe.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = inlineTagRe.exec(line)) !== null) {
      const name = match[2];
      if (!match[1]) {
        active.push(name);
      } else {
        const idx = active.lastIndexOf(name);
        if (idx !== -1) active.splice(idx, 1);
      }
    }
    // Ainult tagidest/tühikutest koosnev füüsiline rida ei vaja tühja <m>-i.
    const visible = line.replace(/<\/?(?:(?:i|b|cs|hi)|(?:ann\d*))>/g, '').trim();
    if (visible === '') return '';
    const closes = [...active].reverse().map(name => `</${name}>`).join('');
    return `<m>${inherited}${line}${closes}</m>`;
  }).join('\n');
}

/**
 * Ehitab muudatused, mis tõstavad valitud teksti uutesse rea-põhistesse `<m>`
 * plokkidesse valiku algusrea kohale. Peidetud marginaalia plokid jäetakse
 * sisust välja (need jäävad kaitsefiltri toel dokumenti alles; sisusse võttes
 * dubleeruks tekst). Avatud marginaalia puudutamise peab kutsuja enne blokeerima.
 */
export function marginaliaFromSelection(
  doc: string,
  from: number,
  to: number,
  hidden: { from: number; to: number }[],
): MarginaliaFromSelection {
  let selected = '';
  let cursor = from;
  for (const h of hidden) {
    if (h.to <= from || h.from >= to) continue;
    selected += doc.slice(cursor, Math.max(cursor, Math.min(h.from, to)));
    cursor = Math.max(cursor, Math.min(h.to, to));
  }
  selected += doc.slice(cursor, to);

  const lineStart = doc.lastIndexOf('\n', from - 1) + 1;
  const wrapped = wrapMarginaliaLines(selected);
  const insert = `${wrapped}\n`;
  const openPositions: number[] = [];
  const openRe = /<m>/g;
  let openMatch: RegExpExecArray | null;
  while ((openMatch = openRe.exec(wrapped)) !== null) {
    openPositions.push(lineStart + openMatch.index + 3);
  }
  const lastClose = wrapped.lastIndexOf('</m>');
  return {
    changes: [
      { from: lineStart, to: lineStart, insert },
      { from, to, insert: '' },
    ],
    openPositions,
    cursor: lineStart + (lastClose >= 0 ? lastClose : wrapped.length),
  };
}
