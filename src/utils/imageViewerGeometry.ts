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
 * Vertikaalne nihe, mis toob skaleeritud pildi ülaserva nähtavale.
 *
 * Tsentreeritud pilt ulatub `C/2 - H*s/2` kuni `C/2 + H*s/2`. Ülaserva
 * nulli viimiseks on vaja `ty = (H*s - C) / 2`.
 *
 * `topInset` nihutab veel allapoole, et pildi ülaserv ei jääks pealkattuvate
 * juhtnuppude (suum / kärpimine / allalaadimine) alla — need on pildi peal
 * `absolute` ribana ja kataksid muidu skaneeringu esimesed tekstiread.
 *
 * Kunagi ei nihutata tsentreeritud asendist ülespoole (tulem ≥ 0): väike pilt,
 * mis mahub tervikuna ära, jääb keskele, mitte ei kleepu ülaserva tühja alaga.
 *
 * @param imageHeight Pildi paigutuslik kõrgus (skaleerimata, `clientHeight`)
 * @param scale Praegune suurendustegur
 * @param containerHeight Nähtava ala kõrgus
 * @param topInset Ülaserva varu juhtnuppude jaoks (px)
 */
export function panOffsetForTop(
  imageHeight: number,
  scale: number,
  containerHeight: number,
  topInset = 0,
): number {
  const overflowY = imageHeight * scale - containerHeight;
  const inset = Number.isFinite(topInset) ? topInset : 0;
  if (!Number.isFinite(overflowY)) return 0;
  return Math.max(0, overflowY / 2 + inset);
}
