import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { LatLngBoundsExpression, divIcon } from 'leaflet';
import { MapContainer, Marker, Popup, useMap } from 'react-leaflet';
import { Loader2, MapPin, Users } from 'lucide-react';
import { fetchPersonMapMarkers } from '../services/prosopographyService';
import { useCollection } from '../../contexts/CollectionContext';
import { deriveMapYear } from '../utils/mapYear';
import HistoricalMapLayer from './HistoricalMapLayer';
import type { ProsopoMapMarker, ProsopoMapResponse } from '../types';

interface PersonsMapProps {
  filters: {
    q?: string;
    gender?: string;
    origin_group?: string;
    institution?: string;
    status_id?: string;
    source?: string;
    year_from?: number;
    year_to?: number;
    imm_year_from?: number;
    imm_year_to?: number;
    related_to?: string;
    collection?: string;
  };
  token?: string;
  focusPlace?: string;
}

function resolveLabel(labels: Record<string, string> | null | undefined, lang: string): string | null {
  if (!labels) return null;
  return labels[lang] ?? labels.et ?? labels.en ?? Object.values(labels)[0] ?? null;
}

function markerIcon(count: number, focused: boolean) {
  const size = count >= 20 ? 42 : count >= 10 ? 36 : count >= 3 ? 31 : 26;
  return divIcon({
    className: '',
    html: `<div class="${focused ? 'vutt-map-marker vutt-map-marker-focused' : 'vutt-map-marker'}" style="width:${size}px;height:${size}px">${count}</div>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
    popupAnchor: [0, -size / 2],
  });
}

type DisplayMarker = ProsopoMapMarker & {
  displayCoordinates: { lat: number; lon: number };
  hasCoordinateOverlap: boolean;
};

function coordinateKey(marker: ProsopoMapMarker): string {
  return `${marker.coordinates.lat.toFixed(6)},${marker.coordinates.lon.toFixed(6)}`;
}

function spreadOverlappingMarkers(markers: ProsopoMapMarker[]): DisplayMarker[] {
  const groups = new Map<string, ProsopoMapMarker[]>();
  for (const marker of markers) {
    const key = coordinateKey(marker);
    groups.set(key, [...(groups.get(key) ?? []), marker]);
  }

  return markers.map(marker => {
    const group = groups.get(coordinateKey(marker)) ?? [marker];
    if (group.length <= 1) {
      return { ...marker, displayCoordinates: marker.coordinates, hasCoordinateOverlap: false };
    }
    const index = group.indexOf(marker);
    const angle = (Math.PI * 2 * index) / group.length;
    const radius = 0.04 + Math.min(group.length, 8) * 0.003;
    return {
      ...marker,
      displayCoordinates: {
        lat: marker.coordinates.lat + Math.sin(angle) * radius,
        lon: marker.coordinates.lon + Math.cos(angle) * radius,
      },
      hasCoordinateOverlap: true,
    };
  });
}

const FitMapToMarkers: React.FC<{ markers: ProsopoMapMarker[]; focusPlace?: string }> = ({ markers, focusPlace }) => {
  const map = useMap();

  useEffect(() => {
    if (markers.length === 0) return;
    const focused = focusPlace
      ? markers.find(marker => marker.place_key === focusPlace || marker.place_id === focusPlace)
      : null;
    if (focused) {
      map.setView([focused.coordinates.lat, focused.coordinates.lon], 8, { animate: false });
      return;
    }
    const bounds = markers.map(marker => [marker.coordinates.lat, marker.coordinates.lon]) as LatLngBoundsExpression;
    map.fitBounds(bounds, { padding: [28, 28], maxZoom: 8, animate: false });
  }, [focusPlace, map, markers]);

  return null;
};

const PersonsMap: React.FC<PersonsMapProps> = ({ filters, token, focusPlace }) => {
  const { t, i18n } = useTranslation(['prosopography', 'common']);
  const { setSelectedCollection, getCollectionName } = useCollection();
  const lang = i18n.language?.slice(0, 2) ?? 'et';
  const [data, setData] = useState<ProsopoMapResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const derivedMapYear = deriveMapYear(filters);
  const [mapYear, setMapYear] = useState(derivedMapYear);
  const [mapYearInput, setMapYearInput] = useState(String(derivedMapYear));
  const parsedMapYear = Number(mapYearInput);
  const isMapYearValid = Number.isInteger(parsedMapYear) && parsedMapYear >= 1 && parsedMapYear <= 9999;

  // Filtrite sisuline võti. Vanem loob `filters`-objekti igal renderdusel uuesti,
  // seega objekti-identiteet muutub ka siis, kui ükski filter ei muutunud.
  const filterKey = JSON.stringify(filters);

  useEffect(() => {
    setMapYear(derivedMapYear);
    setMapYearInput(String(derivedMapYear));
  }, [derivedMapYear]);

  const applyMapYear = () => {
    if (!isMapYearValid) return;
    setMapYear(parsedMapYear);
  };

  useEffect(() => {
    setLoading(true);
    fetchPersonMapMarkers(filters, token)
      .then(result => {
        setData(result);
        setError(null);
      })
      .catch(() => setError(t('loadError', 'Isikute laadimine ebaõnnestus.')))
      .finally(() => setLoading(false));
    // `filters` on TEADLIKULT dep-listist väljas — `filterKey` katab tema sisu.
    // Objekti lisamine siia tühistaks võtme mõtte ja tooks uue võrgupäringu +
    // laadimisvälke iga vanema renderduse peale.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterKey, token, t]);

  const focusedMarker = useMemo(() => {
    if (!focusPlace || !data) return null;
    return data.markers.find(marker => marker.place_key === focusPlace || marker.place_id === focusPlace) ?? null;
  }, [data, focusPlace]);
  const displayMarkers = useMemo(() => data ? spreadOverlappingMarkers(data.markers) : [], [data]);

  if (loading) {
    return (
      <div className="h-[640px] bg-white border border-gray-200 rounded-xl flex items-center justify-center text-gray-400">
        <Loader2 className="w-6 h-6 animate-spin mr-2" />
        {t('loading', 'Laadin…')}
      </div>
    );
  }

  if (error) {
    return <div className="text-center py-16 text-red-600 text-sm">{error}</div>;
  }

  if (!data || data.markers.length === 0) {
    // Vihje: kui seoste-kaart on tühi valitud kollektsiooni tõttu, selgita miks
    // ja paku kollektsiooni vahetamist (vt fix: related_to + kollektsioon).
    const selected = filters.related_to ? filters.collection : undefined;
    const focusName = data?.focus?.label || t('map.thisPerson', 'See isik');
    const otherCollections = (data?.focus?.collections ?? []).filter(c => c !== selected);
    const lng = lang === 'en' ? 'en' : 'et';

    return (
      <div className="min-h-[420px] bg-white border border-gray-200 rounded-xl flex flex-col items-center justify-center gap-3 text-center px-6 py-10">
        <MapPin size={22} className="text-gray-300" />
        <p className="text-gray-500 text-sm">{t('map.noMarkers', 'Kaardile kantavaid päritolukohti ei leitud.')}</p>
        {selected && (
          <div className="max-w-md space-y-3">
            <p className="text-sm text-gray-600">
              {otherCollections.length > 0
                ? t('map.collectionHintNamed', '{{name}} kuulub teise kollektsiooni kui praegu valitud („{{selected}}"). Tema seoste nägemiseks vaheta kollektsiooni.', {
                    name: focusName,
                    selected: getCollectionName(selected, lng),
                  })
                : t('map.collectionHintGeneric', 'Valitud kollektsioonis („{{selected}}") pole selle isiku seoseid.', {
                    selected: getCollectionName(selected, lng),
                  })}
            </p>
            <div className="flex flex-wrap items-center justify-center gap-2">
              {otherCollections.map(c => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setSelectedCollection(c)}
                  className="rounded-full border border-primary-300 bg-primary-50 px-3 py-1.5 text-xs font-medium text-primary-700 hover:bg-primary-100 transition-colors"
                >
                  {t('map.switchToCollection', 'Ava „{{name}}"', { name: getCollectionName(c, lng) })}
                </button>
              ))}
              <button
                type="button"
                onClick={() => setSelectedCollection(null)}
                className="rounded-full border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50 transition-colors"
              >
                {t('map.showAllCollections', 'Näita kõiki kollektsioone')}
              </button>
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3 text-xs text-gray-500">
        <span className="inline-flex items-center gap-1">
          <MapPin size={13} className="text-primary-600" />
          {t('map.markerCount', '{{count}} kohta', { count: data.markers.length })}
        </span>
        <span className="inline-flex items-center gap-1">
          <Users size={13} className="text-primary-600" />
          {t('map.mappedCount', '{{mapped}} / {{total}} isikut kaardil', { mapped: data.mapped_persons, total: data.total_persons })}
        </span>
        {data.without_coordinates > 0 && (
          <span>{t('map.withoutCoordinates', '{{count}} isikul puudub koordinaat', { count: data.without_coordinates })}</span>
        )}
        {focusedMarker && (
          <span className="rounded-full bg-primary-50 border border-primary-200 px-2 py-1 text-primary-700">
            {resolveLabel(focusedMarker.place_labels, lang) ?? focusedMarker.place_key}
          </span>
        )}
        <div className="ml-auto inline-flex items-center gap-2 text-gray-600" title={t('map.yearHelp')}>
          <label htmlFor="prosopo-map-year" className="font-medium">{t('map.year')}</label>
          <input
            id="prosopo-map-year"
            type="number"
            min="1"
            max="9999"
            value={mapYearInput}
            onChange={event => setMapYearInput(event.target.value)}
            onKeyDown={event => {
              if (event.key === 'Enter') applyMapYear();
            }}
            className="w-20 rounded-md border border-gray-300 bg-white px-2 py-1 text-sm text-gray-800 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
          />
          <button
            type="button"
            onClick={applyMapYear}
            disabled={!isMapYearValid || parsedMapYear === mapYear}
            className="rounded-md bg-primary-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-primary-700 disabled:cursor-not-allowed disabled:bg-gray-300"
          >
            {t('map.applyYear')}
          </button>
        </div>
      </div>

      <div className="h-[640px] overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
        <MapContainer
          center={[57.5, 24.5]}
          zoom={5}
          minZoom={1}
          scrollWheelZoom
          className="h-full w-full"
        >
          <HistoricalMapLayer year={mapYear} lang={lang} />
          <FitMapToMarkers markers={data.markers} focusPlace={focusPlace} />
          {displayMarkers.map(marker => {
            const placeLabel = resolveLabel(marker.place_labels, lang) ?? marker.place_key ?? marker.place_id ?? '';
            const parentLabel = resolveLabel(marker.parent?.labels, lang) ?? marker.parent?.key;
            const focused = !!focusPlace && (marker.place_key === focusPlace || marker.place_id === focusPlace);
            return (
              <Marker
                key={marker.place_key ?? marker.place_id ?? `${marker.coordinates.lat},${marker.coordinates.lon}`}
                position={[marker.displayCoordinates.lat, marker.displayCoordinates.lon]}
                icon={markerIcon(marker.count, focused)}
              >
                <Popup>
                  <div className="min-w-56 max-w-72">
                    <div className="mb-2">
                      <h3 className="font-semibold text-gray-900">{placeLabel}</h3>
                      {parentLabel && parentLabel !== placeLabel && <p className="text-xs text-gray-500">{parentLabel}</p>}
                      <p className="text-xs text-gray-400">{marker.count} {t('persons', 'isikut')}</p>
                      {marker.hasCoordinateOverlap && (
                        <p className="text-[11px] text-amber-700">
                          {t('map.shiftedMarker', 'Marker on kattuvuse vältimiseks veidi nihutatud.')}
                        </p>
                      )}
                    </div>
                    <div className="max-h-56 overflow-y-auto space-y-1 pr-1">
                      {marker.persons.map(person => (
                        <Link key={person.id} to={`/persons/${person.id}`} className="block rounded px-2 py-1 text-sm text-primary-700 hover:bg-primary-50">
                          {person.label}
                          {(person.birth_year || person.death_year) && (
                            <span className="ml-1 text-xs text-gray-400">
                              {person.birth_year ?? '?'}-{person.death_year ?? '?'}
                            </span>
                          )}
                        </Link>
                      ))}
                    </div>
                  </div>
                </Popup>
              </Marker>
            );
          })}
        </MapContainer>
      </div>
    </div>
  );
};

export default PersonsMap;
