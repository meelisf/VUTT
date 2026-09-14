/**
 * Töökollektsiooni ligipääsu MUSTAND ja kirjete klassifikatsioon (#318, ADR 0043).
 *
 * `PUT access` on täisasendus: klient saadab terve kaardi ja server
 * klassifitseerib diffi. Siinsed funktsioonid PEEGELDAVAD serveri valvureid,
 * et kasutaja ei näeks nuppu, mis annab 403 — aga nad EI OLE õiguse allikas.
 * Otsus tehakse serveris (`server/work_sets_access.py::check_access_diff`);
 * siin on ainult kuvamisloogika.
 */
import { canManageUser, isAtLeast } from '../../utils/roleUtils';
import { searchUsers as otsiKasutajaid } from '../../utils/userSearch';
import { SetRole } from './workSetAccess';

export type AccessEntryKind = 'normal' | 'role_based' | 'deleted_user';

export interface AccessEntry {
  username: string;
  role: SetRole;
  kind: AccessEntryKind;
  /** Kas seda rida tohib SELLE kutsuja muuta (rolli vahetada)? */
  canChange: boolean;
  /** Kas seda rida tohib SELLE kutsuja eemaldada? */
  canRemove: boolean;
}

export interface KnownUser {
  username: string;
  name: string;
  email: string;
  role: string;
}

export interface Actor {
  username: string;
  role: string;
}

/**
 * Kirjete kuvamiskuju, kasutajanime järgi järjestatud.
 *
 * Järjestus on stabiilne MEELEGA: kaardi võtmete järjekord ei ole lubadus ja
 * hüplev nimekiri teeks „mis muutus" hindamise võimatuks.
 */
export function classifyEntries(
  access: Record<string, SetRole>, users: KnownUser[], actor: Actor,
  opts: { usersKnown?: boolean } = {},
): AccessEntry[] {
  // Haldur EI SAA kasutajate üldloendit (spekk §3) ja admini loendi laadimine
  // võib ebaõnnestuda. Tühja loendi tõlgendamine „kõik on kustutatud" oleks
  // vale vastus: puuduv teadmine ei ole teadmine puudumisest. Sellisel juhul
  // on kõik read lihtsalt lugemisvaade.
  const usersKnown = opts.usersKnown ?? true;
  const rollid = new Map(users.map(u => [u.username, u.role]));
  return Object.keys(access || {}).sort().map(username => {
    const role = access[username];
    const sihtroll = rollid.get(username);

    if (!usersKnown) {
      return { username, role, kind: 'normal' as const,
               canChange: false, canRemove: false };
    }
    if (sihtroll === undefined) {
      // Kustutatud kasutaja jäänuk: server lubab eemaldada, aga rolli muuta
      // mitte (tundmatu kasutajanimi lükatakse uue määranguna tagasi).
      return { username, role, kind: 'deleted_user' as const,
               canChange: false, canRemove: true };
    }
    if (isAtLeast(sihtroll, 'admin')) {
      // Admin+ haldusõigus tuleneb rollist. Kirje on dekoratiivne: uut ei looda,
      // olemasolevat ei muudeta; eemaldada tohib enda või madalama oma.
      return {
        username, role, kind: 'role_based' as const,
        canChange: false,
        canRemove: username === actor.username || canManageUser(actor.role, sihtroll),
      };
    }
    const tohib = canManageUser(actor.role, sihtroll);
    return { username, role, kind: 'normal' as const, canChange: tohib, canRemove: tohib };
  });
}

/** Lisamiseks pakutavad: admin+ ja juba lisatud jäävad välja. */
export function addableUsers(
  users: KnownUser[], access: Record<string, SetRole>, actor: Actor,
): KnownUser[] {
  return users.filter(u =>
    !(u.username in (access || {}))
    && !isAtLeast(u.role, 'admin')
    && canManageUser(actor.role, u.role));
}

/**
 * Diakriitikatundetu kasutajaotsing.
 *
 * Taaseksport jagatud utiliidist: sama otsingut vajab ka kollektsiooni
 * ligipääsupaneel ja kaks koopiat lahknesid juba korra (#318 koristus).
 */
export const searchUsers = otsiKasutajaid<KnownUser>;

/** Kas mustand erineb laetud kaardist? Muutusteta salvestust ei pakuta. */
export function draftChanged(
  loaded: Record<string, SetRole>, draft: Record<string, SetRole>,
): boolean {
  const a = loaded || {};
  const b = draft || {};
  const votmed = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const k of votmed) {
    if (a[k] !== b[k]) return true;
  }
  return false;
}
