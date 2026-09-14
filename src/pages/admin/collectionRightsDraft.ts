/**
 * Kollektsiooniõiguste MUSTAND ja kirjete alus (#318, ADR 0043 p2).
 *
 * Kaks telge (ADR 0031): `allowed` on lugemisõigus piiratud kogule,
 * `edit` on contributori kirjutamisulatus ja kehtib KÕIGILE kogudele.
 * Üks ei anna teist.
 *
 * „Alus" eristab kolme asja, mis vaates näevad sarnased välja: kehtiv
 * määrang, rollist tulenev õigus (mida ei saa eemaldada) ja salvestatud
 * jäänuk, mis praegu ei mõju. Siinsed funktsioonid PEEGELDAVAD serveri
 * reegleid — otsus tehakse serveris (`apply_collection_rights_delta`).
 */
import { canManageUser, isAtLeast } from '../../utils/roleUtils';
import { RightsChange } from '../../services/collectionRightsService';

// `public` väärtust ei omistata kusagil — avaliku kogu jäänuk on `inert`.
export type RightsBasis = 'assigned' | 'role_based' | 'inert';

export interface RightsRow {
  username: string;
  allowed: boolean;
  edit: boolean;
  allowedBasis: RightsBasis;
  editBasis: RightsBasis;
  canManage: boolean;
}

export interface RightsUser {
  username: string;
  name: string;
  email: string;
  role: string;
}

export interface RightsState {
  visibility: 'public' | 'restricted';
  isVirtual: boolean;
  allowed: Set<string>;
  edit: Set<string>;
}

export function rightsRows(
  state: RightsState, users: RightsUser[],
  actor: { username: string; role: string },
  opts: { usersKnown?: boolean } = {},
): RightsRow[] {
  // Tühi kasutajaloend ei tähenda „kõik on tundmatud" (1b õppetund):
  // rolle ei teata, seega rollipõhist alust ei omistata ja midagi ei hallata.
  const usersKnown = opts.usersKnown ?? true;
  const rollid = new Map(users.map(u => [u.username, u.role]));

  const nimed = [...new Set([...state.allowed, ...state.edit])].sort();
  return nimed.map(username => {
    const roll = rollid.get(username);
    const allowed = state.allowed.has(username);
    const edit = state.edit.has(username);

    let allowedBasis: RightsBasis = 'assigned';
    let editBasis: RightsBasis = 'assigned';

    if (usersKnown && roll !== undefined) {
      if (isAtLeast(roll, 'admin')) {
        // Admin+ näeb ja toimetab kõike rollist tulenevalt.
        allowedBasis = 'role_based';
        editBasis = 'role_based';
      } else if (isAtLeast(roll, 'editor')) {
        // Toimetaja kirjutamisulatus on üldine, aga piiratud kogu
        // LUGEMISõigust vajab ta endiselt (ADR 0031).
        editBasis = 'role_based';
      }
    }
    // Avalikul kogul ei mõju salvestatud lugemismäärang — aga ta on alles ja
    // hakkab uuesti mõjuma, kui kogu piiratakse.
    if (allowedBasis === 'assigned' && state.visibility === 'public') {
      allowedBasis = 'inert';
    }

    return {
      username, allowed, edit, allowedBasis, editBasis,
      canManage: usersKnown && roll !== undefined && canManageUser(actor.role, roll),
    };
  });
}

/** Lugemisõiguse määrangu saab lisada AINULT piiratud kogule (server: 400). */
export function canAddAllowed(state: RightsState): boolean {
  return state.visibility === 'restricted';
}

/**
 * Kirjutamisulatust pakutakse ainult contributor-ile: editor+ ulatus tuleb
 * rollist. Virtuaalsele rühmale mitte kunagi — teosele ei saagi virtuaalset
 * gruppi määrata, seega ei saa see olla ka kirjutamisulatuse liige.
 */
export function canAddEdit(state: RightsState, targetRole: string): boolean {
  if (state.isVirtual) return false;
  return !isAtLeast(targetRole, 'editor');
}

/** Muudetud määrangud ühe kogu piires. Puutumata telg ei tekita muudatust. */
export function rightsDelta(
  loaded: RightsState, draft: RightsState, collectionId: string,
): RightsChange[] {
  const out: RightsChange[] = [];
  for (const field of ['allowed', 'edit'] as const) {
    const vana = loaded[field];
    const uus = draft[field];
    for (const username of [...uus].sort()) {
      if (!vana.has(username)) {
        out.push({ username, collection_id: collectionId, field, action: 'add' });
      }
    }
    for (const username of [...vana].sort()) {
      if (!uus.has(username)) {
        out.push({ username, collection_id: collectionId, field, action: 'remove' });
      }
    }
  }
  return out;
}

/** Mitu INIMEST pakett puudutab — sessioonide hoiatuse jaoks. */
export function affectedUsernames(changes: RightsChange[]): string[] {
  return [...new Set(changes.map(c => c.username))].sort();
}
