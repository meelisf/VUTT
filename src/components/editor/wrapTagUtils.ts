import type { EditorState } from '@codemirror/state';

// wrapWithTag abifunktsioonid

export interface TagPair {
  open: number; openEnd: number; close: number; closeEnd: number;
}

/**
 * Leiab, kas antud positsioon asub konkreetse tägi vahel.
 * Otsing on piiratud searchFrom ja searchTo vahemikuga (tavaliselt üks rida).
 */
export function findContainer(tag: string, pos: number, docText: string, searchFrom = 0, searchTo = docText.length): TagPair | null {
  const openTag = `<${tag}>`;
  const closeTag = `</${tag}>`;

  // Leiame viimase avava tägi ENNE positsiooni, aga vahemiku piires
  const lastOpen = docText.lastIndexOf(openTag, pos);
  if (lastOpen === -1 || lastOpen < searchFrom) return null;

  // Leiame esimese sulgeva tägi PÄRAST seda avavat tägi
  const firstClose = docText.indexOf(closeTag, lastOpen + openTag.length);
  if (firstClose === -1 || firstClose > searchTo) return null;

  const closeEnd = firstClose + closeTag.length;
  // Kontrollime, kas kursor/valik on tõesti selle paari vahel
  if (pos >= lastOpen && pos <= closeEnd) {
    return { open: lastOpen, openEnd: lastOpen + openTag.length, close: firstClose, closeEnd };
  }
  return null;
}

/**
 * Leiab kõik antud tägi paarid vahemikus [from, to].
 */
export function findInnerPairs(tag: string, from: number, to: number, docText: string): TagPair[] {
  const openTag = `<${tag}>`;
  const closeTag = `</${tag}>`;
  const pairs: TagPair[] = [];
  let searchFrom = from;
  while (searchFrom < to) {
    const openIdx = docText.indexOf(openTag, searchFrom);
    if (openIdx === -1 || openIdx >= to) break;
    const closeIdx = docText.indexOf(closeTag, openIdx + openTag.length);
    if (closeIdx === -1 || closeIdx > to) break; // Sulgev tägi peab ka jääma vahemikku
    const closeEnd = closeIdx + closeTag.length;
    if (openIdx >= from && closeEnd <= to) {
      pairs.push({ open: openIdx, openEnd: openIdx + openTag.length, close: closeIdx, closeEnd });
    }
    searchFrom = closeEnd;
  }
  return pairs;
}

/**
 * Nihutab lõikekohad [cutFrom, cutTo] vahemikus [lo, hi] VÄLJAPOOLE nii, et
 * lõige ei jääks ühegi tägi sisse ega poolitaks teist paari: `<i>a <b>b</b></i>`
 * poolitus „b" juurest ei tohi anda `<b></i>b<i></b>` (ristuv pesastus).
 */
function balancedCut(
  doc: string, lo: number, hi: number, cutFrom: number, cutTo: number,
): [number, number] {
  // Lõikekoht tägi `<…>` sees → tägi servale.
  const lt = doc.lastIndexOf('<', cutFrom - 1);
  if (lt >= lo && lt > doc.lastIndexOf('>', cutFrom - 1)) cutFrom = lt;
  const ltTo = doc.lastIndexOf('<', cutTo - 1);
  if (ltTo >= lo && ltTo > doc.lastIndexOf('>', cutTo - 1)) {
    const gt = doc.indexOf('>', cutTo);
    if (gt !== -1 && gt < hi) cutTo = gt + 1;
  }

  const tagRe = /<(\/?)([a-z]+)[^>]*?(\/?)>/g;
  // Vasakul sulgemata avatägid → lõige esimese sellise ette.
  const opens: { name: string; pos: number }[] = [];
  for (const m of doc.slice(lo, cutFrom).matchAll(tagRe)) {
    if (m[3]) continue; // <pb/>
    if (!m[1]) opens.push({ name: m[2], pos: lo + m.index });
    else if (opens.length && opens[opens.length - 1].name === m[2]) opens.pop();
  }
  if (opens.length) cutFrom = opens[0].pos;
  // Paremal avamata sulgetägid → lõige viimase sellise järele.
  const pending: string[] = [];
  const base = cutTo;
  for (const m of doc.slice(base, hi).matchAll(tagRe)) {
    if (m[3]) continue;
    if (!m[1]) pending.push(m[2]);
    else if (pending.length && pending[pending.length - 1] === m[2]) pending.pop();
    else cutTo = base + m.index + m[0].length;
  }
  return [cutFrom, Math.max(cutFrom, cutTo)];
}

/**
 * Stiilitägi lülitamine VALIKU peal (võib olla mitu rida). Tagastab muudatused;
 * dispatch ja valiku kaardistus jäävad kutsujale (`wrapWithTag`).
 */
export function selectionWrapChanges(
  state: EditorState,
  tag: string,
): { from: number; to: number; insert: string }[] {
  const { from, to } = state.selection.main;
  const docText = state.doc.toString();
  const openTag = `<${tag}>`;
  const closeTag = `</${tag}>`;
  const lineFrom = state.doc.lineAt(from);
  const lineTo = state.doc.lineAt(to);
  const changes: { from: number; to: number; insert: string }[] = [];

  // NUTIKAS PESASTAMINE: stiilitägi (i, b, cs) puhul liigume struktuuri-tägide
  // (m, hi, fn) SISSE. Nii otsustamisel kui tegevusel — muidu nägi otsus valikut
  // `<m><i>ab</i></m>` mähkimisena ja jättis orvu `<m><i>ab</m>`.
  const skipStructural = (sFrom: number, sTo: number): [number, number] => {
    if (!['i', 'b', 'cs'].includes(tag)) return [sFrom, sTo];
    let adjusted = true;
    while (adjusted) {
      adjusted = false;
      // 1. Kontrollime algust: kas sFrom juures algab suvaline täg?
      const startTagMatch = docText.slice(sFrom, sFrom + 20).match(/^<[^>]+>/);
      if (startTagMatch) {
        const tagName = startTagMatch[0].match(/[a-z]+/)?.[0];
        // Kui on struktuuri-täg, hüppame sisse
        if (tagName && ['m', 'hi', 'fn'].includes(tagName)) {
          sFrom += startTagMatch[0].length;
          adjusted = true;
        }
      }

      // 2. Kontrollime lõppu: kas sTo juures lõpeb suvaline täg?
      const endTagMatch = docText.slice(Math.max(0, sTo - 15), sTo).match(/<\/[^>]+>$/);
      if (endTagMatch) {
        const tagName = endTagMatch[0].match(/[a-z]+/)?.[0];
        if (tagName && ['m', 'hi', 'fn'].includes(tagName)) {
          sTo -= endTagMatch[0].length;
          adjusted = true;
        }
      }

      if (sFrom >= sTo) break;
    }
    return [sFrom, sTo];
  };

  // OTSUSTAMINE: Kas me pakime lahti (unwrap) või paneme tägi ümber (wrap)?
  // Reegel: Kui esimese valitud rea sisu on juba tägi sees, siis me pakime LAHTI kõik valitud read.
  let mode: 'wrap' | 'unwrap' = 'wrap';
  for (let i = lineFrom.number; i <= lineTo.number; i++) {
    const line = state.doc.line(i);
    let sFrom = Math.max(from, line.from);
    let sTo = Math.min(to, line.to);

    // Puhastame servadest tühikud otsuse tegemiseks
    while (sTo > sFrom && /\s/.test(docText[sTo - 1])) sTo--;
    while (sFrom < sTo && /\s/.test(docText[sFrom])) sFrom++;

    if (sFrom < sTo) {
      [sFrom, sTo] = skipStructural(sFrom, sTo);
      const container = findContainer(tag, sFrom, docText, line.from, line.to);
      if (container && sTo <= container.closeEnd) {
        mode = 'unwrap';
      }
      break; // Võtame esimese sisulise rea järgi otsuse vastu
    }
  }

  // TEGEVUS: Käime read läbi ja rakendame muudatused
  for (let i = lineFrom.number; i <= lineTo.number; i++) {
    const line = state.doc.line(i);
    let sFrom = Math.max(from, line.from);
    let sTo = Math.min(to, line.to);

    // Puhastame valiku servadest tühikud/reavahetused
    while (sTo > sFrom && /\s/.test(docText[sTo - 1])) sTo--;
    while (sFrom < sTo && /\s/.test(docText[sFrom])) sFrom++;

    if (sFrom >= sTo) continue; // Tühi rida jääb vahele
    [sFrom, sTo] = skipStructural(sFrom, sTo);

    if (mode === 'unwrap') {
      const container = findContainer(tag, sFrom, docText, line.from, line.to);
      if (container && sTo <= container.closeEnd) {
        // Valik paari sees → paar poolitatakse, mitte ei eemaldata tervikuna:
        // `<i>dium lectio</i>` + „lectio" → `<i>dium </i>lectio`. Ainult
        // tühikuks jääv pool kaob koos oma tägiga.
        const [cutFrom, cutTo] = balancedCut(
          docText, container.openEnd, container.close,
          Math.max(sFrom, container.openEnd), Math.min(sTo, container.close),
        );
        const leftEmpty = docText.slice(container.openEnd, cutFrom).trim() === '';
        const rightEmpty = docText.slice(cutTo, container.close).trim() === '';
        changes.push(leftEmpty
          ? { from: container.open, to: container.openEnd, insert: '' }
          : { from: cutFrom, to: cutFrom, insert: closeTag });
        changes.push(rightEmpty
          ? { from: container.close, to: container.closeEnd, insert: '' }
          : { from: cutTo, to: cutTo, insert: openTag });
      }
    } else {
      // Kui sFrom/sTo asub olemasoleva sama tägi sees, laienda piir tägi alguse/lõpuni
      const startContainer = findContainer(tag, sFrom, docText, line.from, line.to);
      if (startContainer && sFrom > startContainer.open) sFrom = startContainer.open;
      const endContainer = findContainer(tag, sTo, docText, line.from, line.to);
      if (endContainer && sTo < endContainer.closeEnd) sTo = endContainer.closeEnd;

      // WRAP: Eemaldame enne sisemised sama tüüpi tägid, et vältida dubleerimist
      const innerPairs = findInnerPairs(tag, sFrom, sTo, docText);
      // Kui selektsioon algab/lõpeb täpselt olemasoleva tägi piiril, kasuta seda tägina
      // (ära loo uut tägi samale positsioonile — tekitaks konflikti ja pesastuse)
      const leadingPair = innerPairs.length > 0 && innerPairs[0].open === sFrom ? innerPairs[0] : null;
      const trailingPair = innerPairs.length > 0 && innerPairs[innerPairs.length - 1].closeEnd === sTo ? innerPairs[innerPairs.length - 1] : null;
      if (!leadingPair) changes.push({ from: sFrom, to: sFrom, insert: openTag });
      for (const p of innerPairs) {
        if (p === leadingPair) {
          changes.push({ from: p.close, to: p.closeEnd, insert: '' });
        } else if (p === trailingPair) {
          changes.push({ from: p.open, to: p.openEnd, insert: '' });
        } else {
          changes.push({ from: p.open, to: p.openEnd, insert: '' });
          changes.push({ from: p.close, to: p.closeEnd, insert: '' });
        }
      }
      if (!trailingPair) changes.push({ from: sTo, to: sTo, insert: closeTag });
    }
  }
  return changes;
}
