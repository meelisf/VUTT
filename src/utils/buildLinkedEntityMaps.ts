import { LinkedEntity } from '../types/LinkedEntity';
import { capitalizeFirst } from './metadataUtils';

/**
 * Ehitab ID→label ja label→ID kaardid LinkedEntity objektidest.
 * Kasutatakse Dashboard filtrites, et lahendada URL Q-koodid kuvatavaks labeliks
 * ja vastupidi, et ühendada eri keeltes facet'id sama Q-koodi alla.
 *
 * @param items - LinkedEntity objektide massiiv (võib olla tühi)
 * @param lang - Praegune keel ('et' | 'en')
 * @param enrichedLabels - Serverist laetud rikastatud labelid (Q-kood → {et, en, ...})
 * @returns { idToLabel, labelToId } - Mõlemad suunad ühes passeerimises
 */
export function buildLinkedEntityMaps(
  items: (LinkedEntity | null | undefined)[],
  lang: string,
  enrichedLabels: Record<string, Record<string, string>> = {}
): { idToLabel: Record<string, string>; labelToId: Record<string, string> } {
  const idToLabel: Record<string, string> = {};
  const labelToId: Record<string, string> = {};

  for (const item of items) {
    if (!item) continue;

    // Leia parim label praeguses keeles
    const rawLabel =
      (item.id && enrichedLabels[item.id]?.[lang]) ||
      item.labels?.[lang] ||
      item.labels?.['et'] ||
      item.label;

    if (!rawLabel) continue;
    const currentLabel = capitalizeFirst(rawLabel);

    // idToLabel: Q-kood → praeguse keele label
    if (item.id) {
      idToLabel[item.id] = currentLabel;
      labelToId[rawLabel] = item.id;
      labelToId[currentLabel] = item.id;
    }

    // Kõik keelevariantid → praeguse keele label / Q-kood
    if (item.labels) {
      for (const labelVal of Object.values(item.labels)) {
        if (labelVal) {
          idToLabel[labelVal as string] = currentLabel;
          idToLabel[capitalizeFirst(labelVal as string)] = currentLabel;
          if (item.id) {
            labelToId[labelVal as string] = item.id;
            labelToId[capitalizeFirst(labelVal as string)] = item.id;
          }
        }
      }
    }

    // Fallback label
    if (item.label) {
      idToLabel[item.label] = currentLabel;
      idToLabel[capitalizeFirst(item.label)] = currentLabel;
      if (item.id) {
        labelToId[item.label] = item.id;
        labelToId[capitalizeFirst(item.label)] = item.id;
      }
    }
  }

  return { idToLabel, labelToId };
}

/**
 * Kogub LinkedEntity objektid Work[] massiivist antud välja järgi.
 * Toetab nii üksikuid objekte kui massiive.
 *
 * @param works - Teoste massiiv
 * @param getter - Funktsioon, mis tagastab LinkedEntity või LinkedEntity[] töö kohta
 * @returns Kõik LinkedEntity objektid ühes massiivis
 */
export function collectLinkedEntities<T>(
  works: T[],
  getter: (work: T) => LinkedEntity | LinkedEntity[] | null | undefined
): LinkedEntity[] {
  const result: LinkedEntity[] = [];
  for (const work of works) {
    const value = getter(work);
    if (!value) continue;
    if (Array.isArray(value)) {
      result.push(...value.filter(Boolean));
    } else {
      result.push(value);
    }
  }
  return result;
}
