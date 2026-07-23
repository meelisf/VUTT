import { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import type { FilterSpecification, Map as MapLibreMap } from 'maplibre-gl';
import { useMap } from 'react-leaflet';
import '@maplibre/maplibre-gl-leaflet';

const HISTORICAL_STYLE_URL = 'https://www.openhistoricalmap.org/map-styles/historical/historical.json';
const OHM_ATTRIBUTION = '<a href="https://www.openhistoricalmap.org/">OpenHistoricalMap</a>';

interface HistoricalMapLayerProps {
  year: number;
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

/** Leafleti sees renderduv OpenHistoricalMapi MapLibre-vektorkiht. */
const HistoricalMapLayer: React.FC<HistoricalMapLayerProps> = ({ year }) => {
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
    };

    if (mapLibre.isStyleLoaded()) applyYear();
    mapLibre.on('style.load', applyYear);
    return () => {
      mapLibre.off('style.load', applyYear);
    };
  }, [mapLibre, year]);

  return null;
};

export default HistoricalMapLayer;
