// Pisipiltide laadimise taasproovimise loogika (manage-leht).
//
// Taust: aeglase/ebakindla ühenduse taga (või kui serveri thumb-genereerimine
// viibib) ebaõnnestub mõne pisipildi `<img>` laadimine transientselt. Varem
// loobus PageThumb pärast ÜHTE katset jäädavalt → juhuslikud püsivad placeholderid
// keset ruudustikku, kuigi täisreso pilt (käärid) laeb. Lahendus: proovi
// transientset viga mitu korda kasvava viivitusega enne loobumist.

export const THUMB_MAX_RETRIES = 4;

// Kasvav viivitus (ms) koos jitteriga. Jitter on sisestatav (vaikimisi Math.random)
// testitavuse jaoks; väldib kõigi ebaõnnestunud piltide korraga taaslaadimist.
export function thumbRetryDelay(attempt: number, jitter: number = Math.random()): number {
  const base = Math.min(500 * 2 ** (attempt - 1), 5000);
  return base + Math.floor(jitter * 300);
}

// Ehita pisipildi URL: baas + valikuline token-query + valikuline retry-nonce.
// Retry-nonce sunnib brauserit pilti uuesti laadima (väldib cache'itud nurjumist).
export function buildThumbUrl(src: string, tokenQuery: string, retry: number): string {
  const sep = src.includes('?') ? '&' : '?';
  const retryPart = retry > 0 ? `${sep}retry=${retry}` : '';
  return `${src}${tokenQuery}${retryPart}`;
}
