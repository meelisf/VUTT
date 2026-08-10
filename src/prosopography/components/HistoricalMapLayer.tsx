import { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import type { Feature, FeatureCollection } from 'geojson';
import type { FilterSpecification, GeoJSONSource, Map as MapLibreMap } from 'maplibre-gl';
import { useMap } from 'react-leaflet';
import { fetchHistoricalRegions } from '../services/prosopographyService';
import type { HistoricalRegionProperties } from '../types';
import { REGION_DETAIL_ZOOM, REGION_LAYERS, REGION_SOURCE_ID, pickRegionFeature } from '../utils/regionLayers';
import '@maplibre/maplibre-gl-leaflet';

const HISTORICAL_STYLE_URL = 'https://www.openhistoricalmap.org/map-styles/historical/historical.json';
const OHM_ATTRIBUTION = '<a href="https://www.openhistoricalmap.org/">OpenHistoricalMap</a>';
const EMPTY_REGIONS: FeatureCollection = { type: 'FeatureCollection', features: [] };
const REGION_YEAR_CACHE_MAX_ENTRIES = 5;
const DEFAULT_REGION_YEAR = 1650;
const DEFAULT_REGION_BOUNDS = { south: 30, west: -40, north: 70, east: 80 };

interface RegionYearCache {
  features: Map<string | number, Feature>;
  bounds: Array<{ south: number; west: number; north: number; east: number }>;
}

// Sama lehe sees säilivad juba laaditud piirkonnad ka siis, kui kasutaja liigub
// teise riigi juurde ja tagasi. Backend hoiab samu vastuseid pikemalt kettal.
const regionCacheByYear = new Map<number, RegionYearCache>();

function regionCacheForYear(year: number): RegionYearCache {
  let cached = regionCacheByYear.get(year);
  if (!cached) {
    cached = { features: new Map(), bounds: [] };
    regionCacheByYear.set(year, cached);
    while (regionCacheByYear.size > REGION_YEAR_CACHE_MAX_ENTRIES) {
      const oldestYear = regionCacheByYear.keys().next().value;
      if (oldestYear === undefined) break;
      regionCacheByYear.delete(oldestYear);
    }
  }
  return cached;
}

function cachedFeatureCollection(cached: RegionYearCache): FeatureCollection {
  return { type: 'FeatureCollection', features: Array.from(cached.features.values()) };
}

interface HistoricalMapLayerProps {
  year: number;
  lang: string;
}

function dateFilter(year: number): FilterSpecification {
  return [
    'all',
    [
      'any',
      ['!', ['has', 'start_decdate']],
      ['<=', ['to-number', ['get', 'start_decdate'], -10_000_000], year],
    ],
    [
      'any',
      ['!', ['has', 'end_decdate']],
      ['>=', ['to-number', ['get', 'end_decdate'], 10_000_000], year],
    ],
  ] as FilterSpecification;
}

/** Muudab ajalooliste halduspiiride ja piirkonnanimede hierarhia paremini loetavaks. */
function enhanceAdministrativeReadability(map: MapLibreMap): void {
  const paint = (layerId: string, property: string, value: unknown) => {
    if (map.getLayer(layerId)) map.setPaintProperty(layerId, property, value);
  };

  // Riigipiirile hele halo ja selle peale tumedam põhijoon.
  paint('admin_country_lines_z10_case', 'line-color', 'rgba(255, 253, 238, 0.85)');
  paint('admin_country_lines_z10_case', 'line-width', [
    'interpolate', ['linear'], ['zoom'], 2, 2, 5, 3.5, 8, 5,
  ]);
  paint('admin_country_lines_z10', 'line-color', 'rgba(70, 86, 78, 0.9)');
  paint('admin_country_lines_z10', 'line-width', [
    'interpolate', ['linear'], ['zoom'], 2, 0.8, 5, 1.5, 8, 2.2,
  ]);

  // Madalama taseme piirkonnad jäävad riigipiirist teadlikult pehmemaks.
  paint('state_lines_admin_4-case', 'line-color', 'rgba(255, 253, 238, 0.65)');
  paint('state_lines_admin_4-case', 'line-width', [
    'interpolate', ['linear'], ['zoom'], 3, 1.5, 6, 2.5, 9, 4,
  ]);
  paint('state_lines_admin_4', 'line-color', 'rgba(100, 117, 107, 0.75)');
  paint('state_lines_admin_4', 'line-width', [
    'interpolate', ['linear'], ['zoom'], 3, 0.45, 6, 1, 9, 1.6,
  ]);
  paint('admin_admin3', 'line-color', 'rgba(112, 126, 117, 0.65)');

  // Hele halo jätab nimed reljeefse tausta ja markerite vahel loetavaks.
  for (const layerId of ['country_points_labels_cen', 'state_points_labels_centroids']) {
    paint(layerId, 'text-color', layerId === 'country_points_labels_cen' ? '#34463d' : '#52645b');
    paint(layerId, 'text-halo-color', 'rgba(255, 254, 242, 0.95)');
    paint(layerId, 'text-halo-width', 2.25);
    paint(layerId, 'text-halo-blur', 0.5);
  }
}

// Hover on ainus koht, kus kaart läheb värvilisemaks — baaspalett jääb puutumata.
const HOVER_FILL_OPACITY = 0.42;
const HOVER_LINE_WIDTH = 4;
const HOVER_LINE_OPACITY = 0.95;
const HOVER_CASING_WIDTH = 7;
const HOVER_CASING_COLOR = 'rgba(255, 255, 255, 0.85)';

interface LevelStyle {
  fill: [number, number];
  lineWidth: [number, number];
  lineOpacity: [number, number];
}

// [väljasuumitult, sissesuumitult]. Katusüksuse täide läheb päriselt nulli:
// läbipaistvus 0 EI peida feature'it queryRenderedFeatures'i eest, nii et
// alamüksuseta augud säilitavad tooltipi ilma nähtava jäänuktäiteta.
const LEVEL_STYLES: Record<number, LevelStyle> = {
  2: { fill: [0.1, 0], lineWidth: [1, 1.8], lineOpacity: [0.5, 0.8] },
  3: { fill: [0, 0.1], lineWidth: [0, 1], lineOpacity: [0, 0.5] },
};

function addLevelLayers(
  map: MapLibreMap,
  level: number,
  ids: { fill: string; casing: string; line: string },
  beforeId: string | undefined,
): void {
  const style = LEVEL_STYLES[level];
  const filter = ['==', ['get', 'admin_level'], level] as FilterSpecification;
  const fadeIn = REGION_DETAIL_ZOOM - 0.5;
  const fadeOut = REGION_DETAIL_ZOOM + 0.5;

  if (!map.getLayer(ids.fill)) {
    map.addLayer({
      id: ids.fill,
      type: 'fill',
      source: REGION_SOURCE_ID,
      filter,
      paint: {
        'fill-color': ['get', 'color'],
        'fill-opacity': [
          'case',
          ['boolean', ['feature-state', 'hover'], false],
          HOVER_FILL_OPACITY,
          ['interpolate', ['linear'], ['zoom'], fadeIn, style.fill[0], fadeOut, style.fill[1]],
        ],
      },
    }, beforeId);
  }

  // Valge halo põhijoone all: ainult hover'il, et piir loeks reljeefse tausta peal.
  if (!map.getLayer(ids.casing)) {
    map.addLayer({
      id: ids.casing,
      type: 'line',
      source: REGION_SOURCE_ID,
      filter,
      paint: {
        'line-color': HOVER_CASING_COLOR,
        'line-width': [
          'case',
          ['boolean', ['feature-state', 'hover'], false],
          HOVER_CASING_WIDTH,
          0,
        ],
        'line-opacity': [
          'case',
          ['boolean', ['feature-state', 'hover'], false],
          1,
          0,
        ],
      },
    }, beforeId);
  }

  if (!map.getLayer(ids.line)) {
    map.addLayer({
      id: ids.line,
      type: 'line',
      source: REGION_SOURCE_ID,
      filter,
      paint: {
        'line-color': ['get', 'color'],
        'line-width': [
          'case',
          ['boolean', ['feature-state', 'hover'], false],
          HOVER_LINE_WIDTH,
          ['interpolate', ['linear'], ['zoom'], fadeIn, style.lineWidth[0], fadeOut, style.lineWidth[1]],
        ],
        'line-opacity': [
          'case',
          ['boolean', ['feature-state', 'hover'], false],
          HOVER_LINE_OPACITY,
          ['interpolate', ['linear'], ['zoom'], fadeIn, style.lineOpacity[0], fadeOut, style.lineOpacity[1]],
        ],
      },
    }, beforeId);
  }
}

function ensureRegionLayers(map: MapLibreMap): void {
  if (!map.getSource(REGION_SOURCE_ID)) {
    map.addSource(REGION_SOURCE_ID, { type: 'geojson', data: EMPTY_REGIONS });
  }

  const beforeId = map.getLayer('admin_country_lines_z10_case')
    ? 'admin_country_lines_z10_case'
    : undefined;

  // Sama beforeId korral tekib lisamisjärjekorras virn alt üles:
  // katusüksuse täide → halo → joon, seejärel alamüksuse samad kolm peale.
  addLevelLayers(map, 2, {
    fill: REGION_LAYERS.l2Fill,
    casing: REGION_LAYERS.l2Casing,
    line: REGION_LAYERS.l2Line,
  }, beforeId);
  addLevelLayers(map, 3, {
    fill: REGION_LAYERS.l3Fill,
    casing: REGION_LAYERS.l3Casing,
    line: REGION_LAYERS.l3Line,
  }, beforeId);
}

function yearFromHistoricalDate(value: string): string {
  const match = value.match(/^-?\d{1,4}/);
  if (!match) return value;
  return String(Number(match[0]));
}

/** Nimi eelistatud keeles; puuduva tõlke korral teine keel ja lõpuks varunimi. */
function localizedName(
  lang: string,
  labelEt: string | null,
  labelEn: string | null,
  fallback: string | null,
): string | null {
  return (lang === 'en' ? labelEn : labelEt) || labelEt || labelEn || fallback;
}

function regionTooltipContent(properties: HistoricalRegionProperties, lang: string): HTMLElement {
  const content = document.createElement('div');
  content.className = 'space-y-0.5';

  const name = document.createElement('div');
  name.className = 'font-semibold text-gray-900';
  name.textContent = localizedName(lang, properties.label_et, properties.label_en, properties.name);
  content.appendChild(name);

  if (properties.start_date || properties.end_date) {
    const dates = document.createElement('div');
    dates.className = 'text-[11px] text-gray-500';
    dates.textContent = `${properties.start_date ? yearFromHistoricalDate(properties.start_date) : '…'}–${properties.end_date ? yearFromHistoricalDate(properties.end_date) : '…'}`;
    content.appendChild(dates);
  }

  // Vanem on lisainfo: kui backend jättis ta osalise kattuvuse tõttu määramata,
  // ei kuvata rida üldse.
  const parent = localizedName(
    lang,
    properties.parent_label_et,
    properties.parent_label_en,
    properties.parent_name,
  );
  if (parent) {
    const parentRow = document.createElement('div');
    parentRow.className = 'text-[11px] text-gray-400';
    parentRow.textContent = parent;
    content.appendChild(parentRow);
  }

  return content;
}

/** Leafleti sees renderduv OpenHistoricalMapi MapLibre-vektorkiht. */
const HistoricalMapLayer: React.FC<HistoricalMapLayerProps> = ({ year, lang }) => {
  const map = useMap();
  const [mapLibre, setMapLibre] = useState<MapLibreMap | null>(null);
  const originalFilters = useRef(new Map<string, FilterSpecification | null>());

  useEffect(() => {
    const layer = L.maplibreGL({
      style: HISTORICAL_STYLE_URL,
      attributionControl: { customAttribution: OHM_ATTRIBUTION },
    }).addTo(map);
    setMapLibre(layer.getMaplibreMap());

    return () => {
      map.removeLayer(layer);
    };
  }, [map]);

  useEffect(() => {
    if (!mapLibre) return;

    const applyYear = () => {
      const layers = mapLibre.getStyle().layers ?? [];
      const temporalFilter = dateFilter(year);

      for (const layer of layers) {
        if (!('source' in layer) || layer.source !== 'ohm') continue;

        if (!originalFilters.current.has(layer.id)) {
          const original = mapLibre.getFilter(layer.id) as FilterSpecification | undefined;
          originalFilters.current.set(layer.id, original ?? null);
        }
        const original = originalFilters.current.get(layer.id);
        const combined = original
          ? ['all', temporalFilter, original] as FilterSpecification
          : temporalFilter;
        mapLibre.setFilter(layer.id, combined);
      }

      enhanceAdministrativeReadability(mapLibre);
      ensureRegionLayers(mapLibre);
    };

    if (mapLibre.isStyleLoaded()) applyYear();
    mapLibre.on('style.load', applyYear);
    return () => {
      mapLibre.off('style.load', applyYear);
    };
  }, [mapLibre, year]);

  useEffect(() => {
    if (!mapLibre) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let controller: AbortController | null = null;
    const yearCache = regionCacheForYear(year);

    const loadRegions = async () => {
      if (!mapLibre.getSource(REGION_SOURCE_ID)) return;
      const bounds = map.getBounds();
      const width = bounds.getEast() - bounds.getWest();
      const height = bounds.getNorth() - bounds.getSouth();
      const source = mapLibre.getSource(REGION_SOURCE_ID) as GeoJSONSource;
      source.setData(cachedFeatureCollection(yearCache));

      // Backend tagastab vaatest laiema ruudustikuala. Kõik aasta jooksul juba
      // laaditud alad liidetakse, mitte ei asendata viimase vastusega.
      const viewIsCached = yearCache.bounds.some(loadedBounds => (
        bounds.getSouth() >= loadedBounds.south
        && bounds.getWest() >= loadedBounds.west
        && bounds.getNorth() <= loadedBounds.north
        && bounds.getEast() <= loadedBounds.east
      ));
      if (viewIsCached) return;

      // 1650 esimene laadimine kasutab serveris ettevalmistatud Euroopa snapshot'i.
      // Väljaspool seda ala jätkub tavapärane vaatepõhine laadimine.
      const useDefaultSnapshot = year === DEFAULT_REGION_YEAR && yearCache.bounds.length === 0;
      const requestBounds = useDefaultSnapshot
        ? DEFAULT_REGION_BOUNDS
        : {
            south: Math.max(-85, bounds.getSouth()),
            west: Math.max(-180, bounds.getWest()),
            north: Math.min(85, bounds.getNorth()),
            east: Math.min(180, bounds.getEast()),
          };

      // Väga kaugel välja suumides oleks Overpassi vastus ebamõistlikult suur.
      if (!useDefaultSnapshot && (width > 140 || height > 90)) {
        source.setData(EMPTY_REGIONS);
        return;
      }

      controller?.abort();
      controller = new AbortController();
      try {
        const response = await fetchHistoricalRegions({ year, ...requestBounds }, controller.signal);
        const received = response.geojson as unknown as FeatureCollection;
        for (const feature of received.features) {
          const id = feature.id ?? (feature.properties?.relation_id as string | number | undefined);
          if (id !== undefined) yearCache.features.set(id, feature);
        }
        yearCache.bounds.push(response.bounds);
        source.setData(cachedFeatureCollection(yearCache));
      } catch (error) {
        if ((error as Error).name !== 'AbortError') {
          console.warn('Ajalooliste piirkondade laadimine ebaõnnestus', error);
        }
      }
    };

    const scheduleLoad = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(loadRegions, 450);
    };

    map.on('moveend', scheduleLoad);
    mapLibre.on('style.load', scheduleLoad);
    scheduleLoad();
    return () => {
      if (timer) clearTimeout(timer);
      controller?.abort();
      map.off('moveend', scheduleLoad);
      mapLibre.off('style.load', scheduleLoad);
    };
  }, [map, mapLibre, year]);

  useEffect(() => {
    if (!mapLibre) return;
    let hoveredId: string | number | null = null;
    const tooltip = L.tooltip({
      className: 'vutt-region-tooltip',
      direction: 'top',
      offset: [0, -8],
      opacity: 0.96,
    });

    const clearHover = () => {
      if (hoveredId !== null) {
        mapLibre.setFeatureState({ source: REGION_SOURCE_ID, id: hoveredId }, { hover: false });
        hoveredId = null;
      }
      map.getContainer().style.cursor = '';
      tooltip.remove();
    };

    const featureAt = (latlng: L.LatLng) => {
      const point = mapLibre.project([latlng.lng, latlng.lat]);
      // Suum tuleb MapLibre'i kaardilt, et hit-test ja paint oleksid samas
      // koordinaatsüsteemis — Leafleti suum võib sellest nihkes olla.
      return pickRegionFeature(mapLibre.getZoom(), layerId => (
        mapLibre.getLayer(layerId)
          ? mapLibre.queryRenderedFeatures(point, { layers: [layerId] })
          : []
      ));
    };

    const showFeature = (latlng: L.LatLng, feature: ReturnType<typeof featureAt>) => {
      if (!feature || feature.id === undefined) {
        clearHover();
        return;
      }
      if (hoveredId !== feature.id) {
        clearHover();
        hoveredId = feature.id;
        mapLibre.setFeatureState({ source: REGION_SOURCE_ID, id: hoveredId }, { hover: true });
      }
      map.getContainer().style.cursor = 'pointer';
      tooltip
        .setLatLng(latlng)
        .setContent(regionTooltipContent(feature.properties as HistoricalRegionProperties, lang))
        .addTo(map);
    };

    // Kui kasutaja hoiab hiirt paigal ja suumib üle lävendi, uut mousemove'i ei
    // tule — vana esiletõst jääks külge vale tasemega. Suumi lõpus arvutame
    // tabamuse viimase teadaoleva hiirekoha põhjal uuesti.
    let lastLatLng: L.LatLng | null = null;

    const onMouseMove = (event: L.LeafletMouseEvent) => {
      lastLatLng = event.latlng;
      showFeature(event.latlng, featureAt(event.latlng));
    };
    const onClick = (event: L.LeafletMouseEvent) => {
      lastLatLng = event.latlng;
      showFeature(event.latlng, featureAt(event.latlng));
    };
    const onMouseOut = () => {
      lastLatLng = null;
      clearHover();
    };
    const onZoomStart = () => clearHover();
    const onZoomEnd = () => {
      if (lastLatLng) showFeature(lastLatLng, featureAt(lastLatLng));
    };

    map.on('mousemove', onMouseMove);
    map.on('click', onClick);
    map.on('zoomstart', onZoomStart);
    map.on('zoomend', onZoomEnd);
    map.getContainer().addEventListener('mouseleave', onMouseOut);
    return () => {
      clearHover();
      tooltip.remove();
      map.off('mousemove', onMouseMove);
      map.off('click', onClick);
      map.off('zoomstart', onZoomStart);
      map.off('zoomend', onZoomEnd);
      map.getContainer().removeEventListener('mouseleave', onMouseOut);
    };
  }, [lang, map, mapLibre]);

  return null;
};

export default HistoricalMapLayer;
