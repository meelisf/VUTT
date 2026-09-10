/**
 * Sama räsi mis `server/prosopo_biography_fields.py::text_hash`:
 * sha256, esimesed 12 hex-märki, ümbritsev tühik lubjatud.
 *
 * Kaks teostust, üks reegel — kui üht muudad, muuda mõlemat (vrd #292).
 */
export async function textHash(text: string | null | undefined): Promise<string> {
  const normaliseeritud = (text ?? '').trim();
  const bytes = new TextEncoder().encode(normaliseeritud);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('')
    .slice(0, 12);
}
