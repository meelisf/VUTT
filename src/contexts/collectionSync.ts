import { Collections } from '../services/collectionService';
import { ALL_COLLECTIONS } from './collectionUrl';

/**
 * Aktiivse kogu kahesuunaline sünkroniseerimine URL-i ja konteksti vahel (#333).
 *
 * ENNE: kaks efekti eri failides peegeldasid teineteist vastassuundades —
 * `useCollectionUrlSync` kirjutas URL-i konteksti järgi, Dashboardi ja
 * Statistika oma seadsid konteksti URL-i järgi. Kumbki reageeris teise EELMISELE
 * väärtusele, seega ühe sammu faasivahest sündis stabiilne 2-tsükkel: URL vahetus
 * ülem- ja alamkogu vahel ~30 ms tagant, kuni brauser hakkas `replaceState`-i
 * piirama. Kumbki pool ei olnud vale — vale oli see, et kummalgi ei olnud
 * ülimuslikkust.
 *
 * NÜÜD otsustab suuna üks funktsioon ja aluseks on `agreed`: viimane väärtus,
 * milles URL ja kontekst kokku leppisid (meie enda kirjutis või omaksvõetud
 * väline muutus). Lahknemise põhjus on sellest üheselt loetav:
 *
 * - URL kannab veel kokkulepitut → liikus KONTEKST (kasutaja vahetas kogu)
 *   → kirjuta URL üle.
 * - URL kannab midagi muud → liikus URL väljastpoolt (jagatud link, tagasi-nupp)
 *   → võta see konteksti.
 *
 * Tsükkel on nii struktuurselt võimatu: omaksvõtt ei kirjuta URL-i ja lõpetab
 * lahknemise ühe sammuga, mitte ei vasta uue kirjutusega.
 */
export type CollectionSyncAction =
  | { type: 'noop' }
  | { type: 'adopt-url'; value: string | null }
  | { type: 'write-url'; value: string; resetPage: boolean };

/** Kas URL-i väärtuse tohib konteksti võtta? */
function isAdoptable(urlValue: string, collections: Collections): boolean {
  return urlValue === ALL_COLLECTIONS || !!collections[urlValue];
}

/**
 * @param urlValue    `?collection=` praegu (null = parameetrit ei ole)
 * @param selected    konteksti valik (null = kõik kogud)
 * @param agreed      viimane väärtus, milles URL ja kontekst kokku leppisid
 * @param mirrored    kas esimene peegeldus on tehtud
 * @param collections teadaolevad kogud (tundmatut id-d ei võeta konteksti)
 */
export function decideCollectionSync(
  urlValue: string | null,
  selected: string | null,
  agreed: string | null,
  mirrored: boolean,
  collections: Collections,
): CollectionSyncAction {
  const want = selected ?? ALL_COLLECTIONS;
  if (urlValue === want) return { type: 'noop' };

  // Väline muutus võidab: URL-is on midagi, mida meie sinna ei kirjutanud.
  // Tundmatu kogu (kustutatud või ligipääsmatu) EI tühjenda vaadet — siis
  // parandame hoopis URL-i.
  if (urlValue !== null && urlValue !== agreed && isAdoptable(urlValue, collections)) {
    return { type: 'adopt-url', value: urlValue === ALL_COLLECTIONS ? null : urlValue };
  }

  // Leht lähtestatakse AINULT päris vahetusel: URL kannab veel kokkulepitut,
  // seega liikus kontekst. Esimene peegeldus ja katkise lingi parandus jätavad
  // `?page=` alles.
  return { type: 'write-url', value: want, resetPage: mirrored && urlValue === agreed };
}
