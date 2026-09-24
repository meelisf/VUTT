/**
 * Lehe ettevalmistuse (poolitus, pööre) puhas geomeetria — ühine upload'i
 * ülevaatusele ja teose haldusele (#431).
 */

/**
 * Hoiab poolitusjoone vahemikus, kus mõlemad pooled jäävad sisukaks.
 * Sama piir kehtib mõlemal serveriteel: `admin_page_ops.split_page` lükkab
 * väljaspool [0.05, 0.95] tagasi, prepress'i `page_cuts` on leebem
 * (`max(1, min(width - 1, …))`) — 5% servast pole kunagi õige poolituskoht.
 */
export function clampSplitX(x: number): number {
  if (!Number.isFinite(x)) return 0.5;
  return Math.min(0.95, Math.max(0.05, x));
}

/** Liidab pöördele `delta` kraadi ja normaliseerib vahemikku [0, 360). */
export function addRotation(angle: number, delta: number): number {
  return ((angle + delta) % 360 + 360) % 360;
}

/** Pisipildikaardi kasti kuvasuhe (laius/kõrgus). PEAB vastama kaartide
 *  `aspect-[3/4]` klassile (upload'i kontaktleht, teose halduse PageCard). */
export const CARD_BOX_RATIO = 3 / 4;

/**
 * Kui suure osa kasti laiusest pilt `object-contain`-iga tegelikult katab.
 *
 * Lapiti skann (kaheleheline avaus — just see, mida poolitatakse) on kastist
 * laiem ja letterboxitakse: pilt katab kogu laiuse (1) või, portree korral,
 * ainult osa. Joon `left: x%` kasti servast oleks siis VALES kohas — x käib
 * PILDI laiuse kohta. Enne `object-cover`-i ajal oli sama viga vastupidi:
 * lapiti pildi küljed lõigati ära ja joon näitas lõigatud kasti keskkohta.
 */
export function imageWidthRatio(aspect: number | undefined): number {
  return aspect === undefined ? 1 : Math.min(1, aspect / CARD_BOX_RATIO);
}

/** Poolitusjoone asukoht kaardi kasti laiuse protsendina. `aspect` = pildi laius/kõrgus. */
export function cardLineLeftPercent(aspect: number | undefined, x: number): number {
  const w = imageWidthRatio(aspect);
  return ((1 - w) / 2 + x * w) * 100;
}
