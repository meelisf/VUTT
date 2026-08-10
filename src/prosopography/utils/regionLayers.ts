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
 * hiire-tabamusele.
 *
 * `maplibre-gl-leaflet` seab MapLibre'i suumiks alati `leafletZoom - 1`
 * (leaflet-maplibre-gl.js). Seega vaikevaade (Leaflet 5) = ML 4 ja
 * Euroopa-ülevaade (Leaflet 4) = ML 3. Väärtus 3,5 paneb ±0,5 üleminekuriba
 * täpselt nende kahe vahele: Leaflet 4 näitab ainult katusüksust, Leaflet 5
 * ainult alamüksusi.
 */
export const REGION_DETAIL_ZOOM = 3.5;

// Hover on ainus koht, kus kaart läheb värvilisemaks — baaspalett jääb puutumata.
const HOVER_FILL_OPACITY = 0.42;
const HOVER_LINE_WIDTH = 4;
const HOVER_LINE_OPACITY = 0.95;
const HOVER_CASING_WIDTH = 7;
const HOVER_CASING_COLOR = 'rgba(255, 255, 255, 0.85)';

const HOVER = ['boolean', ['feature-state', 'hover'], false];

/**
 * Suumipõhine üleminek, mille hover üle kirjutab.
 *
 * KRITILINE: MapLibre nõuab, et `['zoom']` oleks TIPPTASEME `interpolate`/`step`
 * sisend („zoom expression may only be used as input to a top-level ... expression").
 * Seetõttu käib `case` interpolatsiooni STOPPIDE SISSE, mitte selle ümber.
 * Vastupidine järjekord laseb TypeScriptist läbi, aga viskab `addLayer`-is erindi
 * ja jätab terve kihikomplekti tekkimata.
 */
function zoomFadeWithHover(hoverValue: number, below: number, above: number) {
  return [
    'interpolate', ['linear'], ['zoom'],
    REGION_DETAIL_ZOOM - 0.5, ['case', HOVER, hoverValue, below],
    REGION_DETAIL_ZOOM + 0.5, ['case', HOVER, hoverValue, above],
  ];
}

interface LevelStyle {
  fill: [number, number];
  lineWidth: [number, number];
  lineOpacity: [number, number];
}

// [väljasuumitult, sissesuumitult]. Katusüksuse täide läheb sissesuumides nulli:
// läbipaistvus 0 EI peida feature'it queryRenderedFeatures'i eest, nii et
// alamüksuseta augud säilitavad tooltipi ilma nähtava jäänuktäiteta.
const LEVEL_STYLES: Record<number, LevelStyle> = {
  2: { fill: [0.1, 0], lineWidth: [1, 1.8], lineOpacity: [0.5, 0.8] },
  3: { fill: [0, 0.1], lineWidth: [0, 1], lineOpacity: [0, 0.5] },
};

function levelLayers(level: number, ids: { fill: string; casing: string; line: string }) {
  const style = LEVEL_STYLES[level];
  const filter = ['==', ['get', 'admin_level'], level];

  return [
    {
      id: ids.fill,
      type: 'fill',
      source: REGION_SOURCE_ID,
      filter,
      paint: {
        'fill-color': ['get', 'color'],
        'fill-opacity': zoomFadeWithHover(HOVER_FILL_OPACITY, style.fill[0], style.fill[1]),
      },
    },
    // Valge halo põhijoone all: ainult hover'il, et piir loeks reljeefse tausta peal.
    // Siin ei ole suumisõltuvust, seega tohib 'case' olla kõige välimine.
    {
      id: ids.casing,
      type: 'line',
      source: REGION_SOURCE_ID,
      filter,
      paint: {
        'line-color': HOVER_CASING_COLOR,
        'line-width': ['case', HOVER, HOVER_CASING_WIDTH, 0],
        'line-opacity': ['case', HOVER, 1, 0],
      },
    },
    {
      id: ids.line,
      type: 'line',
      source: REGION_SOURCE_ID,
      filter,
      paint: {
        'line-color': ['get', 'color'],
        'line-width': zoomFadeWithHover(HOVER_LINE_WIDTH, style.lineWidth[0], style.lineWidth[1]),
        'line-opacity': zoomFadeWithHover(HOVER_LINE_OPACITY, style.lineOpacity[0], style.lineOpacity[1]),
      },
    },
  ];
}

/**
 * Kuus kihti alt üles: katusüksuse täide → halo → joon, seejärel alamüksuse samad.
 *
 * Tüüp on tahtlikult lai: MapLibre'i avaldiste TypeScript-tüübid ei püüa neid vigu,
 * mis siin tegelikult juhtuvad (vt zoomFadeWithHover). Päris värav on
 * `validateStyleMin` ühiktest, mis jooksutab sama valideerijat, mida MapLibre ise.
 */
export function regionLayerSpecs(): Array<Record<string, unknown> & { id: string }> {
  return [
    ...levelLayers(2, {
      fill: REGION_LAYERS.l2Fill,
      casing: REGION_LAYERS.l2Casing,
      line: REGION_LAYERS.l2Line,
    }),
    ...levelLayers(3, {
      fill: REGION_LAYERS.l3Fill,
      casing: REGION_LAYERS.l3Casing,
      line: REGION_LAYERS.l3Line,
    }),
  ];
}

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
