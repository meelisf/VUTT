/**
 * Isikupildi suurusvariandid (#424).
 *
 * Server teeb `?w=` päringu peale lähtepildist vähendatud koopia; lubatud
 * laiused PEAVAD kattuma `server/prosopography/image_variants.py`
 * `VARIANT_WIDTHS`-iga (muu laius → 400). Brauser valib `srcSet`-ist kuvalaiuse
 * ja pikslitiheduse järgi. Kärbe jääb CSS-i (`object-cover`/`object-position`).
 */
export const PERSON_IMAGE_WIDTHS = [160, 320, 640] as const;

// Varuvariant brauserile, mis `srcSet`-i ei arvesta.
const FALLBACK_WIDTH = 320;

function withWidth(url: string, width: number): string {
  return `${url}${url.includes('?') ? '&' : '?'}w=${width}`;
}

export function personImageProps(url: string, sizes: string) {
  return {
    src: withWidth(url, FALLBACK_WIDTH),
    srcSet: PERSON_IMAGE_WIDTHS.map(w => `${withWidth(url, w)} ${w}w`).join(', '),
    sizes,
  };
}
