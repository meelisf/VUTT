/**
 * Ühe kasutaja töökollektsiooni-määrangute salvestus (#318, spekk §5).
 *
 * Iga kogu on OMA fail oma `revision`-lukuga — failideülest tehingut ei ole.
 * Seepärast salvestatakse kogu kaupa ja OSALINE edu on tavaline tulemus, mitte
 * erand: juba salvestatut ei saadeta uuesti ja ühe kogu konflikt ei tohi
 * teiste muudatusi ära jätta.
 */
import { AccessChange } from './workSetAccess';

export interface SaveOutcome {
  /** Edukalt salvestatud kogude ID-d. */
  saved: string[];
  /** Salvestamata jäänud kogud koos HTTP-staatusega (409 = revision-konflikt). */
  failed: { setId: string; status?: number }[];
}

export async function saveAccessChanges(
  changes: AccessChange[],
  save: (c: AccessChange) => Promise<unknown>,
): Promise<SaveOutcome> {
  const out: SaveOutcome = { saved: [], failed: [] };
  for (const c of changes) {
    try {
      await save(c);
      out.saved.push(c.setId);
    } catch (e) {
      out.failed.push({ setId: c.setId, status: (e as { status?: number }).status });
    }
  }
  return out;
}
