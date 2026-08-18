/**
 * Väliste identifikaatorite kanooniline kuju — ÜKS allikas frontendis (#240).
 *
 * Peegeldab `server/prosopography/ext_ids.py` reeglit: skeem on juba eraldi
 * väli, seega prefiks ID sees on üleliigne. Varem tegi seda ainult isikuvormi
 * salvestus ja ainult gnd + AA jaoks, mistõttu mujalt (EntityPicker, rikastuse
 * otsing) tulnud ID läks baasi prefiksiga ja lõhkus dublikaadikontrolli.
 */
const PREFIXES: Record<string, string[]> = {
  gnd: ['gnd:'],
  viaf: ['viaf:'],
  wikidata: ['wikidata:', 'wd:'],
  album_academicum: ['album_academicum:', 'aa:'],
};

export function normalizeExtId(scheme: string, extId: string | null | undefined): string {
  if (!extId) return '';
  let value = String(extId).trim();
  if (!value) return '';

  const key = (scheme || '').trim().toLowerCase();
  for (const prefix of PREFIXES[key] ?? []) {
    if (value.toLowerCase().startsWith(prefix)) {
      value = value.slice(prefix.length).trim();
      break;
    }
  }

  if (key === 'wikidata') {
    value = value.toUpperCase();
  } else if (key === 'gnd' && value.slice(-1).toLowerCase() === 'x') {
    // GND kontrollnumber on alati suur X
    value = value.slice(0, -1) + 'X';
  }

  return value;
}
