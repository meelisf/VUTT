/**
 * Ühe KASUTAJA kollektsiooniõiguste mustand (#318, ADR 0043 p2).
 *
 * Peegelpilt `collectionRightsDraft.ts`-ist: seal on read kasutajate kohta
 * ühes kogus, siin kogude kohta ühel kasutajal. Serveri toiming on SAMA
 * (`apply_collection_rights_delta`) ja ka `RightsChange` kolmik on sama —
 * teist kirjutusteed ei looda.
 *
 * Kaks telge (ADR 0031): `allowed` = lugemisõigus piiratud kogule, `edit` =
 * contributori kirjutamisulatus (kehtib KÕIGILE kogudele). Üks ei anna teist.
 *
 * Siinsed funktsioonid PEEGELDAVAD serveri reegleid — otsus tehakse serveris.
 */
import { isAtLeast } from '../../utils/roleUtils';
import { RightsChange } from '../../services/collectionRightsService';
import { RightsBasis } from './collectionRightsDraft';

export interface CollectionInfo {
  id: string;
  name: string;
  visibility: 'public' | 'restricted';
  isVirtual: boolean;
}

export interface UserRightsState {
  allowed: Set<string>;
  edit: Set<string>;
}

export interface UserRightsRow {
  collectionId: string;
  name: string;
  /** Kas kogu on konfiguratsioonis olemas? `false` = kustutatud kogu jäänuk. */
  exists: boolean;
  allowed: boolean;
  edit: boolean;
  allowedBasis: RightsBasis;
  editBasis: RightsBasis;
}

/**
 * Read kogude kaupa: kõik, millel on SALVESTATUD määrang kummalgi teljel.
 * Olemasolevad kogud nime järgi, kustutatud jäänukid lõppu — hüplev
 * järjestus teeks „mis muutus" hindamise võimatuks.
 */
export function userRightsRows(
  state: UserRightsState,
  collections: Record<string, CollectionInfo>,
  targetRole: string,
): UserRightsRow[] {
  const idd = [...new Set([...state.allowed, ...state.edit])];
  const read = idd.map<UserRightsRow>(id => {
    const kogu = collections[id];
    const exists = kogu !== undefined;

    let allowedBasis: RightsBasis = 'assigned';
    let editBasis: RightsBasis = 'assigned';
    if (isAtLeast(targetRole, 'admin')) {
      // Admin+ näeb ja toimetab kõike rollist tulenevalt; kirje on dekoratiivne.
      allowedBasis = 'role_based';
      editBasis = 'role_based';
    } else if (isAtLeast(targetRole, 'editor')) {
      // Toimetaja ulatus on üldine, LUGEMISõigust vajab ta endiselt (ADR 0031).
      editBasis = 'role_based';
    }

    if (!exists) {
      // Kustutatud kogu ID ei ole kehtiv õigus, aga ta on andmetes alles ja
      // ainus tee teda maha võtta on see rida.
      allowedBasis = 'inert';
      editBasis = 'inert';
    } else if (allowedBasis === 'assigned' && kogu.visibility === 'public') {
      // Avalikul kogul määrang ei mõju — aga ta taasjõustub, kui kogu piiratakse.
      allowedBasis = 'inert';
    }

    return {
      collectionId: id,
      name: exists ? kogu.name : id,
      exists,
      allowed: state.allowed.has(id),
      edit: state.edit.has(id),
      allowedBasis,
      editBasis,
    };
  });

  return read.sort((a, b) => {
    if (a.exists !== b.exists) return a.exists ? -1 : 1;
    return a.name.localeCompare(b.name, 'et');
  });
}

/** Lisatav lugemisõigus: AINULT piiratud kogu (server vastab avalikule 400-ga). */
export function addableAllowed(
  collections: Record<string, CollectionInfo>, state: UserRightsState,
): CollectionInfo[] {
  return Object.values(collections)
    .filter(c => c.visibility === 'restricted' && !state.allowed.has(c.id))
    .sort((a, b) => a.name.localeCompare(b.name, 'et'));
}

/**
 * Lisatav kirjutamisulatus: ainult contributor'ile (editor+ ulatus tuleb
 * rollist) ja mitte virtuaalsele rühmale — teosele ei saagi virtuaalset
 * gruppi määrata, seega ei saa see olla ka ulatuse liige.
 */
export function addableEdit(
  collections: Record<string, CollectionInfo>,
  state: UserRightsState,
  targetRole: string,
): CollectionInfo[] {
  if (isAtLeast(targetRole, 'editor')) return [];
  return Object.values(collections)
    .filter(c => !c.isVirtual && !state.edit.has(c.id))
    .sort((a, b) => a.name.localeCompare(b.name, 'et'));
}

/** Muudetud määrangud ühe KASUTAJA piires. Puutumata kogu ei tekita muudatust. */
export function userRightsDelta(
  loaded: UserRightsState, draft: UserRightsState, username: string,
): RightsChange[] {
  const out: RightsChange[] = [];
  for (const field of ['edit', 'allowed'] as const) {
    const vana = loaded[field];
    const uus = draft[field];
    for (const id of [...uus].sort()) {
      if (!vana.has(id)) out.push({ username, collection_id: id, field, action: 'add' });
    }
    for (const id of [...vana].sort()) {
      if (!uus.has(id)) out.push({ username, collection_id: id, field, action: 'remove' });
    }
  }
  return out;
}
