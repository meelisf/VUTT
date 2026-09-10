import type { ProsopoRecord } from '../types';
import { pickBiography, type BioLang, type BiographyPick } from './biographyChain';

export interface BiographyBlocksModel {
  /** Eluloo ahela tulemus (ADR 0039, otsus 4) või null. */
  biography: BiographyPick | null;
  /** AA-toorik. EI OLE eluloo varuvariant — omaette plokk, alati kui täidetud. */
  aaRecord: string | null;
}

/** Isikulehe kahe eluloo-ploki OTSUS ühes puhtas funktsioonis. */
export function biographyBlocksModel(
  person: Pick<ProsopoRecord, 'biography_et' | 'biography_en' | 'aa_raw'>,
  lang: BioLang,
): BiographyBlocksModel {
  return {
    biography: pickBiography(person, lang),
    aaRecord: (person.aa_raw ?? '').trim() || null,
  };
}
