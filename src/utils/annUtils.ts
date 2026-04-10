import type { TextAnnotation } from '../types';

/** Järgmine vaba annotatsioon-ID (max olemasolevast + 1, miinimum 1).
 *  MVP: eeldab ühe kasutaja korraga toimetamist. */
export function nextAnnId(annotations: TextAnnotation[]): number {
  if (annotations.length === 0) return 1;
  return Math.max(...annotations.map(a => a.id)) + 1;
}

/** Ekstrakib highlightitud teksti <annN>...</annN> tägide vahelt. */
export function extractHighlightedText(text: string, id: number): string {
  const m = text.match(new RegExp(`<ann${id}>([\\s\\S]*?)<\\/ann${id}>`));
  return m ? m[1] : '';
}

/** Eemaldab <annN> ja </annN> tägid, jätab sisu alles. */
export function removeAnnTags(text: string, id: number): string {
  return text
    .replace(new RegExp(`<ann${id}>`, 'g'), '')
    .replace(new RegExp(`<\\/ann${id}>`, 'g'), '');
}

/** Kontrollib, kas tekstilõigus [from, to) esineb mõni ann-täg (avav või sulgev).
 *  Kasutatakse kattumisvältimisel enne uue annotatsiooni lisamist. */
export function containsAnnTag(text: string, from: number, to: number): boolean {
  const slice = text.slice(from, to);
  return /<\/?ann\d+>/.test(slice);
}

/** Leiab kõik ann-ID-d tekstis. Kasutatakse konsistentsikontrollis. */
export function findAnnIdsInText(text: string): number[] {
  const ids = new Set<number>();
  const re = /<ann(\d+)>/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    ids.add(parseInt(m[1], 10));
  }
  return Array.from(ids);
}
