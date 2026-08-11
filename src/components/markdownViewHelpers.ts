// Puhtad tekstiteisendused MarkdownView jaoks. DOM-vabad, unit-testitavad.
// Teisendus toimub AINULT renderdamisel — salvestatud tekst jääb muutmata.

// CommonMark loeb rea alguses oleva "N." (kuni 9 kohta) nummerdatud loendi
// markeriks. Vabatekstis (Elulugu, Märkmed, kommentaarid) algab lõik aga sageli
// aastaarvu või kuupäevaga ("1759. aastal…", "1. jaanuaril…") — sellest sai
// <ol start="1759">, mis nihutas lõigu taandesse ja asendas aastaarvu
// loendinumbriga.
//
// Kaks reeglit, mis eristavad prosat päris loendist:
//   1. kolme- või enamakohaline marker (aastaarv) escape'itakse ALATI —
//      loendit, mis algab numbrist 100+, praktikas ei kirjutata;
//   2. ühe- või kahekohaline marker jääb loendiks ainult siis, kui samas
//      plokis (järjestikuste mittetühjade ridade jadas) on vähemalt KAKS
//      sellist rida — üksik "1. jaanuaril…" on kuupäev, mitte loend.
//
// Escape = kurakaldkriips markeri punkti/sulu ees ("1759\."), mis on
// CommonMarki tavaline escape ja renderdub täpselt algse tekstina.

const ORDERED_MARKER = /^( {0,3})(\d{1,9})([.)])(?=[ \t]|$)/;
const FENCE = /^ {0,3}(?:```|~~~)/;
const YEAR_LIKE_DIGITS = 3;

export function escapeAccidentalOrderedLists(content: string): string {
  if (!content) return content;
  const lines = content.split('\n');

  // Tarastatud koodiplokkide read jäävad puutumata (seal on kurakaldkriips nähtav).
  const inCode: boolean[] = [];
  let fenced = false;
  for (const line of lines) {
    if (FENCE.test(line)) {
      inCode.push(true);
      fenced = !fenced;
      continue;
    }
    inCode.push(fenced);
  }

  const out = [...lines];
  let i = 0;
  while (i < lines.length) {
    if (inCode[i] || lines[i].trim() === '') {
      i++;
      continue;
    }
    // Plokk = järjestikused mittetühjad read väljaspool koodiplokki.
    let end = i;
    while (end < lines.length && !inCode[end] && lines[end].trim() !== '') end++;

    const markers: { line: number; yearLike: boolean }[] = [];
    for (let k = i; k < end; k++) {
      const m = lines[k].match(ORDERED_MARKER);
      if (m) markers.push({ line: k, yearLike: m[2].length >= YEAR_LIKE_DIGITS });
    }
    const isList = markers.filter((m) => !m.yearLike).length >= 2;

    for (const { line, yearLike } of markers) {
      if (isList && !yearLike) continue;
      out[line] = lines[line].replace(ORDERED_MARKER, '$1$2\\$3');
    }

    i = end;
  }

  return out.join('\n');
}
