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
