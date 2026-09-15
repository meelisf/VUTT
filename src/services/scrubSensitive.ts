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

/** Päring ja fragment; jutumärkides väärtus võib sisaldada tühikuid. */
const PARAM = /([?&#;])([^=\s?&#;]+)=("[^"]*"|'[^']*'|[^?&#;\s)\]]*)/g;

function decodeForInspection(value: string): string {
  for (let i = 0; i < 4 && value.includes('%'); i++) value = decodeURIComponent(value);
  if (value.includes('%')) throw new Error('Liiga sügav kodeering');
  return value;
}

function scrubParams(text: string): string {
  return text.replace(PARAM, (match, sep, key, value) => {
    try {
      const normalizedKey = decodeForInspection(key);
      const bare = decodeForInspection(value).replace(/^["']|["']$/g, '');
      return isSensitive(normalizedKey, bare) ? `${sep}${normalizedKey}=${REDACTED}` : match;
    } catch {
      return `${sep}${REDACTED}`;
    }
  });
}

/** Sama puhastus URL-i, veateate ja stacki jaoks. */
export function scrubText<T extends string | undefined | null>(text: T): T {
  if (!text) return text;
  // Kodeeritud lõiku ei dekodeerita väljundisse: nii ei teki uusi eraldajaid
  // ega jää osa tühikut sisaldavast saladusest alles. Sügavuse piir on ühine
  // Pythoniga. Vigane või liiga sügav kodeering jäetakse tervenisti välja.
  const checked = scrubParams(text).replace(/\S+/g, chunk => {
    if (!chunk.includes('%')) return chunk;
    try {
      const decoded = decodeForInspection(chunk);
      if (scrubParams(decoded) !== decoded) return REDACTED;
      return chunk;
    } catch {
      return REDACTED;
    }
  });
  return scrubParams(checked) as T;
}

export function scrubUrl(url: string): string {
  return scrubText(url);
}
