/**
 * Teose pealkirja kuvamine liidese keeles (ADR 0064).
 *
 * `title` on põhipealkiri oma keeles; `title_{keel}` on tõlge; `title_original`
 * allikast transkribeeritud pealkiri. Kuvamise otsustab `title_devised`, MITTE
 * teose `type` — segateos (trükis + käsikiri) kannab trükise pealkirja.
 *
 * - koostatud pealkiri: liidese keele tõlge läheb põhireale, originaal teiseks;
 * - transkribeeritud pealkiri: `title` jääb põhireale, tõlge teiseks.
 *
 * Uus pealkirja kuvamiskoht kasutab SEDA, mitte paljast `work.title`-it.
 */

export interface TitleFields {
  title?: string;
  title_en?: string;
  title_original?: string;
  title_devised?: boolean;
}

export interface DisplayTitle {
  main: string;
  secondary: string | null;
}

/** Liidese keele tõlge; eesti keelel eraldi välja ei ole — põhipealkiri on eestikeelne. */
function translationFor(work: TitleFields, lang: string): string {
  if (lang === 'et') return '';
  const value = (work as Record<string, unknown>)[`title_${lang}`];
  return typeof value === 'string' ? value.trim() : '';
}

export function workDisplayTitle(work: TitleFields, lang: string): DisplayTitle {
  const title = work.title || '';
  const translation = translationFor(work, lang);
  const original = (work.title_original || '').trim();

  if (work.title_devised === true) {
    return {
      main: translation || title,
      secondary: original || null,
    };
  }
  return {
    main: title,
    secondary: translation || original || null,
  };
}

export type OtherTitleKey = 'titleInEstonian' | 'titleEn' | 'titleOriginal';

/**
 * Teose lehe jaoks: kõik pealkirjakujud peale põhirea, igaüks oma sildiga.
 * `title` saab sildi „eesti keeles" ainult siis, kui ta ei ole põhireal — see
 * juhtub ainult koostatud (eestikeelse) pealkirja puhul.
 */
export function otherTitles(work: TitleFields, lang: string): { key: OtherTitleKey; value: string }[] {
  const main = workDisplayTitle(work, lang).main;
  const candidates: { key: OtherTitleKey; value: string }[] = [
    { key: 'titleInEstonian', value: (work.title || '').trim() },
    { key: 'titleEn', value: (work.title_en || '').trim() },
    { key: 'titleOriginal', value: (work.title_original || '').trim() },
  ];
  return candidates.filter(c => c.value && c.value !== main);
}
