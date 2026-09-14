/**
 * Kasutaja töökollektsiooni-ligipääsu muudatuste arvutamine (#354).
 *
 * Ligipääs elab KOGU küljes (`ws.access[username]`), mitte kasutaja küljes.
 * Seepärast tähendab „anna Jürile vaataja õigus" ühe kogu `access`-kaardi
 * ümberkirjutamist — ja see kaart sisaldab ka teiste kasutajate õigusi.
 * Puhas funktsioon, et „ei kustuta kellegi teise õigusi" oleks testitav.
 */
import { WorkSetSummary } from '../../services/workSetService';

export type SetRole = 'viewer' | 'manager';

export function applyUserRole(
  access: Record<string, SetRole> | undefined,
  username: string,
  role: SetRole | null,
): Record<string, SetRole> {
  const next = { ...(access || {}) };
  // Rolli puudumine on võtme PUUDUMINE, mitte tühi väärtus: server lükkaks
  // tundmatu rolli tagasi ja tühi string jätaks kirje alles.
  if (role === null) delete next[username];
  else next[username] = role;
  return next;
}

export interface AccessChange {
  setId: string;
  access: Record<string, SetRole>;
  revision: number;
}

/**
 * @param wanted soovitud roll kogu kaupa. Kogu, mida siin EI OLE, jääb
 *   puutumata — vaikimisi „puudub" kustutaks teiste antud õigused.
 */
export function accessChanges(
  sets: WorkSetSummary[],
  username: string,
  wanted: Record<string, SetRole | null>,
): AccessChange[] {
  const out: AccessChange[] = [];
  for (const ws of sets) {
    if (!(ws.id in wanted)) continue;
    if (!ws.can_manage) continue;  // server keelaks niikuinii; ära saada
    const praegune = (ws.access || {})[username] ?? null;
    const soovitud = wanted[ws.id] ?? null;
    if (praegune === soovitud) continue;
    out.push({
      setId: ws.id,
      access: applyUserRole(ws.access as Record<string, SetRole>, username, soovitud),
      revision: ws.revision,
    });
  }
  return out;
}
