/**
 * Kasutajate haldusloendi filtrid (#318, spekk §1).
 *
 * Need on HALDUSLOENDI filtrid, mitte koguvalik: `rights_collection` ja
 * `rights_work_set` ei muuda aktiivset kogu ega puutu `CollectionContext`-i
 * (ADR 0038). Puhas funktsioon, et URL-i ja tulemuse seos oleks testitav.
 */
import { searchUsers } from '../../utils/userSearch';

export interface ListUser {
  username: string;
  name: string;
  email: string;
  role: string;
  allowed_collections?: string[];
  edit_collections?: string[];
}

export interface UserFilters {
  q: string;
  role: string;             // '' = kõik rollid
  rightsCollection: string; // '' = kõik
  rightsWorkSet: string;    // '' = kõik
}

export const EMPTY_FILTERS: UserFilters = {
  q: '', role: '', rightsCollection: '', rightsWorkSet: '',
};

/**
 * @param workSetAccess kogu-ID → `access`-kaart (username → roll). Tundmatu
 *   kogu ID annab TÜHJA tulemuse, mitte filtri ärajätmise: „kogu, mida ei ole"
 *   ja „kõik kasutajad" on kaks eri asja (ADR 0042 sama loogika).
 */
export function filterUsers<T extends ListUser>(
  users: T[], f: UserFilters, workSetAccess: Record<string, Record<string, string>>,
): T[] {
  let out = users;
  if (f.role) out = out.filter(u => u.role === f.role);
  if (f.rightsCollection) {
    // Mõlemad teljed: „kellel on selle koguga seotud SALVESTATUD määrang".
    out = out.filter(u =>
      (u.allowed_collections || []).includes(f.rightsCollection)
      || (u.edit_collections || []).includes(f.rightsCollection));
  }
  if (f.rightsWorkSet) {
    const kaart = workSetAccess[f.rightsWorkSet] || {};
    out = out.filter(u => u.username in kaart);
  }
  return searchUsers(out, f.q);
}

/** URL → filtrid. Tundmatu parameeter jäetakse tähelepanuta. */
export function filtersFromParams(p: URLSearchParams): UserFilters {
  return {
    q: p.get('q') || '',
    role: p.get('role') || '',
    rightsCollection: p.get('rights_collection') || '',
    rightsWorkSet: p.get('rights_work_set') || '',
  };
}

/** Filtrid → URL. Tühi väärtus EI lähe URL-i, et jagatav link jääks puhtaks. */
export function paramsFromFilters(f: UserFilters): Record<string, string> {
  const out: Record<string, string> = {};
  if (f.q) out.q = f.q;
  if (f.role) out.role = f.role;
  if (f.rightsCollection) out.rights_collection = f.rightsCollection;
  if (f.rightsWorkSet) out.rights_work_set = f.rightsWorkSet;
  return out;
}
