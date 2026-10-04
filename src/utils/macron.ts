// Lühendusmärk on makron U+0304, mitte tilde (ADR 0062). Redaktori „makron"-toiming
// lisab kursori ees olevale ladina tähele makroni; teine vajutus eemaldab selle.
// Olemasolev tilde/ülakriips (U+0303/U+0305) asendatakse makroniga — nii saab vana
// teksti `ũ`/`m̃` ühe vajutusega parandada. Kaart kattub `server/macron.py`-ga.

const MACRON = '̄';
const ABBREV_MARKS = /[̃̄̅]/g;
const COMBINING = /\p{M}/u;
const LATIN_LETTER = /^\p{Script=Latin}$/u;

export interface MacronChange {
  from: number;
  to: number;
  insert: string;
}

/**
 * Arvutab muudatuse tähele, mis lõpeb positsioonil `pos` (s.o kursori ees).
 * Tagastab `null`, kui kursori ees ei ole ladina tähte (nt tühik, number,
 * kreeka täht) — toiming on siis no-op.
 */
export function macronChangeAt(text: string, pos: number): MacronChange | null {
  if (pos <= 0 || pos > text.length) return null;
  // Kursori ees olev graafeem: alustäht + temale järgnevad kombineerivad märgid.
  let start = pos;
  while (start > 0 && COMBINING.test(text[start - 1])) start--;
  if (start === 0) return null;
  start -= 1;
  const cluster = text.slice(start, pos);
  const decomposed = cluster.normalize('NFD');
  // Ainult ladina täht. Surrogaatpaari pool (nt MUFI privaatala) ei sobitu siin.
  if (!LATIN_LETTER.test(decomposed[0]) || !/\p{L}/u.test(decomposed[0])) return null;
  const hadMacron = decomposed.includes(MACRON);
  const hadOtherMark = /[̃̅]/.test(decomposed);
  const stripped = decomposed.replace(ABBREV_MARKS, '');
  // Makron ainult → eemalda (lülitus); tilde/ülakriips või puudub → makron.
  const next = hadMacron && !hadOtherMark ? stripped : insertMacron(stripped);
  const insert = next.normalize('NFC');
  if (insert === cluster) return null;
  return { from: start, to: pos, insert };
}

// Makron vahetult alustähe järele (enne muid kombineerivaid märke, nt täppe) —
// NFC kanooniline järjestus teeb ülejäänu.
function insertMacron(decomposed: string): string {
  return decomposed[0] + MACRON + decomposed.slice(1);
}
