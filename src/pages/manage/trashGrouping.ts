import { FILE_API_URL } from '../../config';
import type { DeletedWorkPage } from '../../services/workApi';

/** Prügikasti kirjed kahte plokki. `unknown` läheb kustutatud lehtede juurde
 *  sildiga — fail on kettal olemas ja nähtamatu kirje on halvem kui sildistatud. */
export function ruhmita(pages: DeletedWorkPage[]): {
  deleted: DeletedWorkPage[];
  split: DeletedWorkPage[];
} {
  const deleted: DeletedWorkPage[] = [];
  const split: DeletedWorkPage[] = [];
  for (const p of pages) (p.reason === 'split' ? split : deleted).push(p);
  return { deleted, split };
}

/** `<img src>` ei saa saata Authorization päist → token käib query-parameetris
 *  (server toetab seda `deps.py`-s). `v` on lähtefaili mtime_ns: failinimi ei
 *  muutu, seega ilma selleta näitaks brauser asendatud pildi asemel vana. */
export type ThumbKind = 'trash' | 'original' | 'current';

export function historyThumbUrl(
  workId: string, kind: ThumbKind, filename: string,
  v: number, token: string | null,
): string {
  const base = `${FILE_API_URL}/admin/work/${workId}/history-thumb/${kind}/${encodeURIComponent(filename)}`;
  return `${base}?v=${v}&token=${encodeURIComponent(token ?? '')}`;
}
