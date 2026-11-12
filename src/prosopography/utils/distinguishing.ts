/**
 * Isiku eristav rida (ADR 0082): käsitsi kirjutatud täiend (`name.qualifier`) ja
 * kuupäevad. Samanimelised isikud peavad valijas ja loendis olema eristatavad.
 *
 * Ametit, kohta ega seisust siin TEADLIKULT ei tuletata: enamikul kaartidest
 * ametit pole ja „esimene amet" ei iseloomusta isikut (koduõpetaja vs professor).
 * Täiendi kirjutab toimetaja.
 *
 * Server saadab ainult toorväljad (`qualifier`, aastad, floruit); sama reegel on
 * MCP-s (`mcp/vutt_mcp/persons.py`, `_plain_label`) — muuda mõlemat koos.
 */
import type { ProsopoIndexEntry, ProsopoRecord } from '../types';

export interface DistinguishingSource {
  qualifier?: string | null;
  birth_year?: number | null;
  death_year?: number | null;
  floruit_year_from?: number | null;
  floruit_year_to?: number | null;
}

const FL = 'fl.';

/** Eluaastad; nende puudumisel tegutsemisperiood. Tühi string, kui midagi pole. */
export function yearsText(p: DistinguishingSource): string {
  const b = p.birth_year || null;
  const d = p.death_year || null;
  if (b && d) return `${b}–${d}`;
  if (b) return `*${b}`;
  if (d) return `†${d}`;
  const from = p.floruit_year_from || null;
  const to = p.floruit_year_to || null;
  if (from && to) return `${FL} ${from}–${to}`;
  if (from || to) return `${FL} ${from ?? to}`;
  return '';
}

/** Täiend ja aastad komaga koos — nime järel hallilt näidatav osa. */
export function distinguishingText(p: DistinguishingSource): string {
  return [(p.qualifier ?? '').trim(), yearsText(p)].filter(Boolean).join(', ');
}

/** Tavateksti kuju (sildid, eksport): `Nimi (täiend, 1608–1660)`. */
export function plainPersonLabel(label: string, p: DistinguishingSource): string {
  const extra = distinguishingText(p);
  return extra ? `${label} (${extra})` : label;
}

function yearOf(d: { date?: string | null } | null | undefined): number | null {
  const raw = (d?.date ?? '').trim();
  if (!/^\d{4}/.test(raw)) return null;
  return parseInt(raw.slice(0, 4), 10) || null;   // "0000" = teadmata
}

/** Täiskaardilt (isikuleht, vorm) sama kuju, mis indeksikirjel. */
export function distinguishingFromPerson(person: ProsopoRecord): DistinguishingSource {
  return {
    qualifier: person.name?.qualifier ?? null,
    birth_year: yearOf(person.birth),
    death_year: yearOf(person.death),
    floruit_year_from: person.floruit?.year_from ?? null,
    floruit_year_to: person.floruit?.year_to ?? null,
  };
}

const nimeVoti = (s: string) => s.trim().toLocaleLowerCase().replace(/\s+/g, ' ');

/**
 * Samanimelised isikud: sama `label` tõstutundetult (ADR 0082 p 4). Otsingu
 * tulemus on hägune — siin jäävad alles ainult täpsed nimekujud. Isik ise ja
 * ühendatud (tombstone) kaardid jäetakse välja.
 */
export function sameNamePersons(
  label: string,
  entries: ProsopoIndexEntry[],
  excludeId: string | null | undefined,
): ProsopoIndexEntry[] {
  const voti = nimeVoti(label);
  if (!voti) return [];
  return entries.filter(e => e.id !== excludeId && e.record_status !== 'tombstone' && nimeVoti(e.label ?? '') === voti);
}
