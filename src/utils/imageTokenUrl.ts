/**
 * Pildiallkirja URL-abilised (#673). Kontekst (`ImageTokenContext`) re-ekspordib need.
 */
export interface ImageToken {
  exp: number;
  sig: string;
}

/** `exp=…&sig=…` ilma eraldajata — kutsuja paneb `?` või `&`. */
export const imageTokenQuery = (t: ImageToken | null | undefined): string =>
  t ? `exp=${t.exp}&sig=${t.sig}` : '';

export function withImageToken(url: string, t: ImageToken | null | undefined): string {
  if (!t) return url;
  return `${url}${url.includes('?') ? '&' : '?'}${imageTokenQuery(t)}`;
}
