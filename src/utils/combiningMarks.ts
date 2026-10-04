// Kombineerivad märgid redaktoris: märk läheb kursori ees olevale tähele, teine
// vajutus eemaldab. Nupud on erimärkide paneeli ees (kasutaja märgikomplektist
// sõltumatud), makronil ka kiirklahv Alt-M.
//
// Makron = lühendusmärk (ADR 0062): ainult ladina tähel; olemasolev tilde või
// ülakriips (U+0303/U+0305) asendatakse — `ũ`/`m̃` saab ühe vajutusega parandada.
// Kaart kattub `server/macron.py`-ga.
// Aktsendid — tsirkumfleks, akuut, graavis — välistavad üksteist (ühel tähel üks
// aktsent). Tsirkumfleks kreeka tähel on perispomeni U+0342 (ᾶ), akuut/graavis
// U+0301/U+0300 mõlemas kirjasüsteemis. Hõngusmärke (spiritus) nupuga ei panda —
// kreeka sisestajad teevad seda klaviatuurilt.
// Järjekord tähe kohal: hõngusmärk/täpid → makron → aktsent (ἄ, ΐ, ǘ, ǖ, ḗ).
// Kõik need on kanoonilises klassis 230 — NFC ei järjesta neid ümber, ja vales
// järjekorras ei moodustu precomposed täht.

export type CombiningMark = 'macron' | 'circumflex' | 'acute' | 'grave';

export interface MarkChange {
  from: number;
  to: number;
  insert: string;
}

type Script = 'latin' | 'greek';

interface MarkSpec {
  /** Lisatav märk kirjasüsteemi kaupa; puuduv kirjasüsteem = no-op. */
  insert: Partial<Record<Script, string>>;
  /** Märgirühm, mis enne lisamist eemaldatakse (üks märk rühmast korraga). */
  group: RegExp;
}

const ACCENTS = /[\u0300\u0301\u0302\u0342]/g;

const SPECS: Record<CombiningMark, MarkSpec> = {
  macron: { insert: { latin: '\u0304' }, group: /[\u0303\u0304\u0305]/g },
  circumflex: { insert: { latin: '\u0302', greek: '\u0342' }, group: ACCENTS },
  acute: { insert: { latin: '\u0301', greek: '\u0301' }, group: ACCENTS },
  grave: { insert: { latin: '\u0300', greek: '\u0300' }, group: ACCENTS },
};

const COMBINING = /\p{M}/u;
const TRAILING_ACCENTS = /[\u0300\u0301\u0302\u0342]*$/;

function scriptOf(ch: string): Script | null {
  if (!/\p{L}/u.test(ch)) return null;
  if (/\p{Script=Latin}/u.test(ch)) return 'latin';
  if (/\p{Script=Greek}/u.test(ch)) return 'greek';
  return null;
}

/**
 * Arvutab muudatuse tähele, mis lõpeb positsioonil `pos` (s.o kursori ees).
 * `null`, kui kursori ees ei ole sobivat tähte (tühik, number, vale kirjasüsteem)
 * — toiming on siis no-op.
 */
export function markChangeAt(text: string, pos: number, kind: CombiningMark): MarkChange | null {
  if (pos <= 0 || pos > text.length) return null;
  // Kursori ees olev graafeem: alustäht + temale järgnevad kombineerivad märgid.
  let start = pos;
  while (start > 0 && COMBINING.test(text[start - 1])) start--;
  if (start === 0) return null;
  start -= 1;
  const cluster = text.slice(start, pos);
  const decomposed = cluster.normalize('NFD');
  const script = scriptOf(decomposed[0]); // surrogaatpaari pool (MUFI) → null
  const spec = SPECS[kind];
  const mark = script ? spec.insert[script] : undefined;
  if (!mark) return null;

  const marks = decomposed.slice(1);
  const stripped = marks.replace(spec.group, '');
  // Lülitus: rühmast on olemas AINULT sama märk → eemalda. Muidu (märki pole,
  // või on rühma teine märk: tilde makroni asemel, akuut graavise asemel) → sea.
  const groupCount = marks.length - stripped.length;
  let nextMarks: string;
  if (groupCount === 1 && marks.includes(mark)) {
    nextMarks = stripped;
  } else if (kind === 'macron') {
    // Makron olemasolevate märkide (täpid) järele, aga aktsendi ette: ǖ, ḗ.
    const accents = stripped.match(TRAILING_ACCENTS)?.[0] ?? '';
    nextMarks = stripped.slice(0, stripped.length - accents.length) + mark + accents;
  } else {
    // Aktsent viimaseks: hõngusmärgi ja täppide järele (ἄ, ΐ, ǘ).
    nextMarks = stripped + mark;
  }
  const insert = (decomposed[0] + nextMarks).normalize('NFC');
  if (insert === cluster) return null;
  return { from: start, to: pos, insert };
}
