/**
 * Pildivaaturi panimise geomeetria.
 *
 * Vaatur kasutab `transform: translate(tx, ty) scale(s)` koos
 * `transformOrigin: center center`-iga ja pilt on konteineris flex-iga
 * tsentreeritud. CSS-i transform-loend rakendub paremalt vasakule: kõigepealt
 * skaleeritakse element ümber oma keskme, seejärel nihutatakse. Seega on
 * `translate` **skaleerimata** konteineri pikslites — mitte pildi omades.
 */

/**
 * Vertikaalne nihe, mis toob skaleeritud pildi ülaserva konteineri ülaserva.
 *
 * Tsentreeritud pilt ulatub `C/2 - H*s/2` kuni `C/2 + H*s/2`. Ülaserva
 * nulli viimiseks on vaja `ty = (H*s - C) / 2`.
 *
 * Kui pilt mahub konteinerisse tervikuna (ülejääk ≤ 0), on õige asend
 * tsentreeritud ehk 0 — ülaserva "kleepimine" jätaks alla tühja ala.
 *
 * @param imageHeight Pildi paigutuslik kõrgus (skaleerimata, `clientHeight`)
 * @param scale Praegune suurendustegur
 * @param containerHeight Nähtava ala kõrgus
 */
export function panOffsetForTop(imageHeight: number, scale: number, containerHeight: number): number {
  const overflowY = imageHeight * scale - containerHeight;
  if (!Number.isFinite(overflowY) || overflowY <= 0) return 0;
  return overflowY / 2;
}
