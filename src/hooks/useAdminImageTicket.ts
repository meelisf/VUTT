import { useEffect, useState } from 'react';
import { apiGet } from '../services/apiClient';
import type { ImageToken } from '../utils/imageTokenUrl';

/**
 * Admini pildipilet (#764): `<img src>` ei kanna Authorization-päist ja
 * sessioonitoken EI TOHI käia URL-is (jääks 24 h kehtivana access-logi).
 * Server annab ühe ulatuse (`upload:<id>` | `work:<id>`) kohta 1 h kehtiva
 * allkirja (`GET /admin/image-ticket`), mis läheb URL-i `?exp=&sig=`-ina.
 */
const REFRESH_MARGIN_MS = 5 * 60 * 1000;

// Võti sisaldab sessioonitokenit: teise kasutaja (või uue sessiooni) pilet ei
// saa siit tulla. Üks päring ulatuse kohta, ka siis kui sada kaarti küsib korraga.
const cache = new Map<string, Promise<ImageToken | null>>();

const isFresh = (t: ImageToken) => t.exp * 1000 - Date.now() > REFRESH_MARGIN_MS;

function fetchTicket(scope: string, authToken: string): Promise<ImageToken | null> {
  const key = `${authToken}|${scope}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const p = apiGet<ImageToken>(`/admin/image-ticket?scope=${encodeURIComponent(scope)}`,
    { token: authToken, timeout: 10000 })
    .then(t => (t?.exp && t?.sig ? { exp: t.exp, sig: t.sig } : null))
    .catch(() => null)
    .then(t => {
      // Tõrge ja aegumisele lähenev pilet ei jää vahemällu: järgmine küsija proovib uuesti.
      if (!t) cache.delete(key);
      else setTimeout(() => { if (cache.get(key) === p) cache.delete(key); },
        Math.max(t.exp * 1000 - Date.now() - REFRESH_MARGIN_MS, 0));
      return t;
    });
  cache.set(key, p);
  return p;
}

/** Ulatuse pilet; `null`, kuni seda pole. Uueneb enne aegumist ise. */
export function useAdminImageTicket(scope: string | null, authToken: string | null): ImageToken | null {
  const [state, setState] = useState<{ key: string; ticket: ImageToken } | null>(null);
  const key = scope && authToken ? `${authToken}|${scope}` : null;

  useEffect(() => {
    if (!scope || !authToken || !key) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const load = () => {
      void fetchTicket(scope, authToken).then(ticket => {
        if (cancelled) return;
        if (!ticket) {
          timer = setTimeout(load, 15000);
          return;
        }
        setState({ key, ticket });
        timer = setTimeout(load, Math.max(ticket.exp * 1000 - Date.now() - REFRESH_MARGIN_MS, 60000));
      });
    };
    load();
    return () => { cancelled = true; if (timer) clearTimeout(timer); };
  }, [scope, authToken, key]);

  return state && state.key === key && isFresh(state.ticket) ? state.ticket : null;
}

/** Ainult testidele. */
export function _resetAdminImageTicketCache(): void {
  cache.clear();
}
