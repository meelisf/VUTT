import type { ProsopoIndexEntry, ProsopoRecord } from '../types';

export type BioLang = 'et' | 'en';

export interface BiographyPick {
  text: string;
  /** Millise keele tekst tegelikult valiti. */
  lang: BioLang;
  /** Kas see EI ole lugeja keel — siis vajab kuvamine keelemärget. */
  isFallback: boolean;
}

const other = (lang: BioLang): BioLang => (lang === 'et' ? 'en' : 'et');
const filled = (v?: string | null): string => (v ?? '').trim();

/**
 * Eluloo ahel (spekk, otsus 4): oma keel → teine keel (+ märge) → mitte midagi.
 *
 * AA-kirje EI OLE selles ahelas: ta on teist liiki sisu ja renderdub omaette
 * plokina ALATI, kui ta on täidetud — ka siis, kui elulugu on olemas.
 */
export function pickBiography(
  person: Pick<ProsopoRecord, 'biography_et' | 'biography_en'>,
  lang: BioLang,
): BiographyPick | null {
  const own = filled(lang === 'et' ? person.biography_et : person.biography_en);
  if (own) return { text: own, lang, isFallback: false };

  const alt = other(lang);
  const fallback = filled(alt === 'et' ? person.biography_et : person.biography_en);
  if (fallback) return { text: fallback, lang: alt, isFallback: true };

  return null;
}

export type SnippetSource = 'biography_et' | 'biography_en' | 'notes' | 'aa_raw';

export interface SnippetPick {
  text: string;
  source: SnippetSource;
  /** null märkmete ja AA-kirje puhul — need ei kanna keelemärget. */
  lang: BioLang | null;
  isFallback: boolean;
}

/**
 * Katke ahel (spekk, otsus 6): oma keel → teine keel → märkmed → AA-kirje.
 *
 * `aa_snippet` on ahela lõpus TEADLIKULT: ilma selleta kaotaks 308 kaarti
 * nimekirjas katke ära, ja AA-kirje algus (nimi, aastad, päritolu) on
 * nimekirjavaates informatiivne.
 */
export function pickSnippet(entry: ProsopoIndexEntry, lang: BioLang): SnippetPick | null {
  const alt = other(lang);
  const chain: { text: string; source: SnippetSource; lang: BioLang | null }[] = [
    { text: filled(lang === 'et' ? entry.biography_snippet_et : entry.biography_snippet_en),
      source: (lang === 'et' ? 'biography_et' : 'biography_en'), lang },
    { text: filled(alt === 'et' ? entry.biography_snippet_et : entry.biography_snippet_en),
      source: (alt === 'et' ? 'biography_et' : 'biography_en'), lang: alt },
    { text: filled(entry.notes_snippet), source: 'notes', lang: null },
    { text: filled(entry.aa_snippet), source: 'aa_raw', lang: null },
  ];

  for (let i = 0; i < chain.length; i += 1) {
    const kandidaat = chain[i];
    if (kandidaat.text) {
      return { ...kandidaat, isFallback: i > 0 };
    }
  }
  return null;
}

// Katke allikas → i18n võti. Kaardistus on TOTAALNE (`Record<SnippetSource, string>`):
// uus allikas ei kompileeru enne, kui talle on märge antud.
const BADGE_KEY: Record<SnippetSource, string> = {
  biography_et: 'snippetInEstonian',
  biography_en: 'snippetInEnglish',
  notes: 'snippetNotes',
  aa_raw: 'snippetAaRecord',
};

/**
 * Märke i18n võti, või `null`, kui katke on lugeja enda keelest.
 *
 * Märge on AUSUSE küsimus: ilma selleta näeks lugeja võõrkeelset teksti või
 * AA-kirjet nii, nagu oleks see tema keeles kirjutatud elulugu (ADR 0039).
 */
export function snippetBadgeKey(pick: SnippetPick): string | null {
  return pick.isFallback ? BADGE_KEY[pick.source] : null;
}
