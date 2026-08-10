/**
 * Ajalooliste piirkonnakihtide ID-d ja suumist sõltuv valikuloogika.
 *
 * MapLibre'i `queryRenderedFeatures()` tagastab ka kihid, mille läbipaistvus on 0
 * (välja jäävad ainult `visibility: none` ja suumivahemikust väljas olevad kihid).
 * Seetõttu ei piisa sellest, et alamüksuse kiht on väljasuumitult nähtamatu —
 * hiire-tabamus peab suumi eraldi arvesse võtma, muidu näitaks Euroopa-ülevaade
 * tooltipiks üksust, mida kasutaja ei näe.
 */

export const REGION_SOURCE_ID = 'vutt-historical-regions';

export const REGION_LAYERS = {
  l2Fill: 'vutt-historical-regions-l2-fill',
  l2Casing: 'vutt-historical-regions-l2-casing',
  l2Line: 'vutt-historical-regions-l2-line',
  l3Fill: 'vutt-historical-regions-l3-fill',
  l3Casing: 'vutt-historical-regions-l3-casing',
  l3Line: 'vutt-historical-regions-l3-line',
} as const;

/**
 * Lävend MapLibre'i suumiskaalas — AINUS tõe allikas nii paint-avaldistele kui
 * hiire-tabamusele. Kalibreeritud nii, et vaikevaade (Leaflet zoom 5) näitab juba
 * alamüksusi ja kokkutõmbumine katusüksuseks toimub Euroopa-ülevaates.
 */
export const REGION_DETAIL_ZOOM = 3.5;

/** Kihid, mida antud suumil tohib hiirega tabada, kõige spetsiifilisem eespool. */
export function regionQueryLayers(zoom: number): string[] {
  return zoom >= REGION_DETAIL_ZOOM
    ? [REGION_LAYERS.l3Fill, REGION_LAYERS.l2Fill]
    : [REGION_LAYERS.l2Fill];
}

/**
 * Võidab esimene kiht, mis üldse midagi tagastab; kihi sees esimene ehk pealmine
 * vaste. Kuna backend sordib piirkonnad pindala järgi kahanevalt, on pealmine
 * ühtlasi väikseim — nii võidab kõige spetsiifilisem üksus ka taseme sees.
 */
export function pickRegionFeature<T>(
  zoom: number,
  queryLayer: (layerId: string) => T[],
): T | null {
  for (const layerId of regionQueryLayers(zoom)) {
    const hit = queryLayer(layerId)[0];
    if (hit !== undefined) return hit;
  }
  return null;
}
