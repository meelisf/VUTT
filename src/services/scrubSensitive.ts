/**
 * Volituste eemaldamine vearaportist (#133).
 *
 * `/set-password?token=<uuid>` loeb tokeni päringustringist. Toores
 * `window.location.search` kirjutaks kehtiva kutse- või paroolivahetuse tokeni
 * admini nähtavasse logisse — täpselt see kuju, mis tegi #237 lekke võimalikuks.
 *
 * **Reegel on kaheosaline, sest kumbki pool üksi lekiks:**
 *  1. **Võtmenimi** — katab lühikesi väärtusi, mida kuju järgi ei tunneks
 *     (`?reset=1` ei ole tokeni moodi, aga ta käib tokeni kõrval).
 *  2. **Väärtuse kuju** — katab tulevasi võtmenimesid, mida keegi ei mäletanud
 *     nimekirja lisada. Paljas denylist on nimekiri, mis jääb alati maha.
 *
 * Sama reegel elab ka serveris (`server/client_errors.py`): klient on ANDMED,
 * mitte usaldusväärne filter. Vana või pahatahtlik klient ei tohi saata seda,
 * mida server salvestada ei tohi.
 */

export const REDACTED = '<eemaldatud>';

/** Võtmenimed, mille väärtus ei tohi KUNAGI logisse jõuda. */
const SENSITIVE_KEYS = new Set([
  'token', 'auth_token', 'access_token', 'refresh_token',
  'reset', 'invite', 'key', 'apikey', 'api_key',
  'password', 'pwd', 'secret', 'sig', 'signature', 'exp', 'session',
]);

/** UUID (paroolivahetuse token on just see kuju) või pikk hex/base64-laadne jada. */
const TOKENISH = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LONG_OPAQUE = /^[A-Za-z0-9_-]{24,}$/;

function isSensitive(key: string, value: string): boolean {
  if (SENSITIVE_KEYS.has(key.toLowerCase())) return true;
  return TOKENISH.test(value) || LONG_OPAQUE.test(value);
}

/**
 * Puhastab URL-i päringustringi. Tee jääb alati alles — just tema ütleb,
 * MIS lehel viga juhtus.
 */
export function scrubUrl(url: string): string {
  try {
    const [path, query] = url.split('?');
    if (!query) return url;
    const params = new URLSearchParams(query);
    const out = new URLSearchParams();
    params.forEach((value, key) => {
      out.append(key, isSensitive(key, value) ? REDACTED : value);
    });
    const rendered = decodeURIComponent(out.toString());
    return rendered ? `${path}?${rendered}` : path;
  } catch {
    // Katkine URL: parem kaotada diagnostika kui lekitada.
    return url.split('?')[0] ?? '';
  }
}

/** Sama päringustringide jaoks, mis peituvad veateate või stacki SEES. */
export function scrubText<T extends string | undefined | null>(text: T): T {
  if (!text) return text;
  try {
    return (text as string).replace(
      /([?&])([A-Za-z0-9_-]+)=([^&\s"')\]]+)/g,
      (match, sep, key, value) => (isSensitive(key, value) ? `${sep}${key}=${REDACTED}` : match),
    ) as T;
  } catch {
    return text;
  }
}
