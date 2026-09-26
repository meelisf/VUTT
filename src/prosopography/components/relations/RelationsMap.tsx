// src/prosopography/components/relations/RelationsMap.tsx
/**
 * Isikulehe seoste kaart (#461): samad andmed mis teistel vahekaartidel + fookusisiku
 * elukäik. Alus ühine PersonsMap-iga (mapBase, HistoricalMapLayer).
 */
import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { divIcon } from 'leaflet';
import { MapContainer, Marker, Polyline, Popup } from 'react-leaflet';
import HistoricalMapLayer from '../HistoricalMapLayer';
import { FitToPoints, spreadOverlapping, type LatLon } from '../map/mapBase';
import { fetchPlaces } from '../../services/prosopographyService';
import type { PlaceEntry, ProsopoRecord } from '../../types';
import type { VisibleNetwork } from '../../utils/network';
import { KIND_ORDER } from '../../utils/network';
import { layerPoints, lifeView, mapYearOf, originGroups, originPrintLinks, printPlaces, type MapLayer, type RegistryState } from '../../utils/relationsMap';
import { KIND_COLOR } from './kindStyle';
import type { usePopover } from './RelationPopover';

type Layer = MapLayer;
const LAYERS: Layer[] = ['origin', 'originPrint', 'print', 'life'];

let placesPromise: Promise<Record<string, PlaceEntry>> | null = null;
// Viga EI muutu tühjaks registriks — siis väidaks elukäik iga jaama kohta „registris puudub".
const loadPlaces = () => (placesPromise ??= fetchPlaces().catch(err => { placesPromise = null; throw err; }));

function pieIcon(kinds: Partial<Record<string, number>>, count: number) {
  const total = Object.values(kinds).reduce<number>((a, b) => a + (b ?? 0), 0) || 1;
  let acc = 0;
  const stops = KIND_ORDER.filter(k => kinds[k]).map(k => {
    const from = (acc / total) * 100; acc += kinds[k] ?? 0; const to = (acc / total) * 100;
    return `${KIND_COLOR[k]} ${from}% ${to}%`;
  }).join(', ');
  const size = count >= 20 ? 40 : count >= 10 ? 34 : count >= 3 ? 29 : 24;
  return divIcon({
    className: '',
    html: `<div style="width:${size}px;height:${size}px;border-radius:50%;border:2px solid #fff;box-shadow:0 1px 3px rgba(0,0,0,.35);background:conic-gradient(${stops});display:flex;align-items:center;justify-content:center;color:#fff;font:600 11px system-ui;text-shadow:0 0 2px #000">${count}</div>`,
    iconSize: [size, size], iconAnchor: [size / 2, size / 2], popupAnchor: [0, -size / 2],
  });
}

function dotIcon(label: string | number, fill: string, hollow = false, size = 22) {
  return divIcon({
    className: '',
    html: `<div style="width:${size}px;height:${size}px;border-radius:50%;border:2px solid ${hollow ? fill : '#fff'};background:${hollow ? '#fff' : fill};box-shadow:0 1px 3px rgba(0,0,0,.35);display:flex;align-items:center;justify-content:center;color:${hollow ? fill : '#fff'};font:600 11px system-ui">${label}</div>`,
    iconSize: [size, size], iconAnchor: [size / 2, size / 2], popupAnchor: [0, -size / 2],
  });
}

const RelationsMap: React.FC<{
  net: VisibleNetwork; card: ProsopoRecord | null;
  popover: ReturnType<typeof usePopover>; onHighlight: (id: string | null) => void;
}> = ({ net, card, popover, onHighlight }) => {
  const { t, i18n } = useTranslation(['prosopography']);
  const lang = i18n.language?.slice(0, 2) ?? 'et';
  const [layer, setLayer] = useState<Layer>('origin');
  const [registry, setRegistry] = useState<RegistryState>('loading');
  useEffect(() => {
    let alive = true;
    loadPlaces().then(r => { if (alive) setRegistry(r); }).catch(() => { if (alive) setRegistry('error'); });
    return () => { alive = false; };
  }, []);

  const origin = useMemo(() => originGroups(net), [net]);
  const prints = useMemo(() => printPlaces(net), [net]);
  const links = useMemo(() => originPrintLinks(net), [net]);
  const life = useMemo(() => lifeView(card, registry), [card, registry]);
  const year = useMemo(() => mapYearOf(net, card?.birth?.date ? Number(card.birth.date.slice(0, 4)) + 30 : 1650), [net, card]);
  const focusCoords = net.focus.origin?.coordinates ?? null;

  const points: LatLon[] = useMemo(() => layerPoints(layer, net, life), [layer, net, life]);

  const pinFromLeaflet = (id: string, ev: { originalEvent: MouseEvent }) =>
    popover.pin(id, ev.originalEvent as unknown as React.MouseEvent);
  const originMarkers = spreadOverlapping(origin.groups, g => g.coords);

  return (
    <div className="space-y-2">
      <div role="radiogroup" aria-label={t('network.tabs.map')} className="inline-flex flex-wrap overflow-hidden rounded border border-gray-200 text-xs">
        {LAYERS.map((l, i) => (
          <button key={l} type="button" role="radio" aria-checked={layer === l} onClick={() => setLayer(l)}
            className={`px-2.5 py-1 ${i ? 'border-l border-gray-200' : ''} ${layer === l ? 'bg-gray-800 text-white' : 'bg-white text-gray-600'}`}>
            {t(`network.layers.${l}`)}
          </button>
        ))}
      </div>
      <p className="text-xs text-gray-600">{t(`network.layerHelp.${layer}`)}</p>
      <div className="h-[520px] overflow-hidden rounded-lg border border-gray-200">
        <MapContainer center={[57.5, 24.5]} zoom={5} minZoom={1} scrollWheelZoom className="h-full w-full">
          <HistoricalMapLayer year={year} lang={lang} />
          <FitToPoints points={points} />
          {(layer === 'origin' || layer === 'originPrint') && focusCoords && (
            <Marker position={[focusCoords.lat, focusCoords.lon]} icon={dotIcon('★', '#1d2126', false, 26)}>
              <Popup>{net.focus.label} · {net.focus.origin?.place}</Popup>
            </Marker>
          )}
          {layer === 'origin' && originMarkers.map(g => (
            <Marker key={g.key} position={[g.display.lat, g.display.lon]} icon={pieIcon(g.kinds, g.persons.length)}>
              <Popup>
                <div className="min-w-48 max-w-72">
                  <div className="font-semibold text-gray-900">{g.label}</div>
                  <div className="max-h-56 space-y-0.5 overflow-y-auto">
                    {g.persons.map(p => (
                      <div key={p.id}>
                        <Link to={`/persons/${p.id}`} className="text-primary-700 hover:underline">{p.label}</Link>
                        <span className="ml-1 text-xs text-gray-500">{t(`network.kinds.${p.kind}`)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </Popup>
            </Marker>
          ))}
          {layer === 'originPrint' && links.map(l => (
            <Polyline key={`${l.personId}-${l.workId}`} positions={[[l.from.lat, l.from.lon], [l.to.lat, l.to.lon]]}
              pathOptions={{ color: KIND_COLOR.academic, weight: 2, opacity: 0.7 }}
              eventHandlers={{
                mouseover: () => onHighlight(l.personId),
                mouseout: () => onHighlight(null),
                click: e => pinFromLeaflet(l.personId, e as unknown as { originalEvent: MouseEvent }),
              }} />
          ))}
          {(layer === 'originPrint' || layer === 'print') && prints.map(p => (
            <Marker key={p.key} position={[p.coords.lat, p.coords.lon]}
              icon={dotIcon(layer === 'print' ? p.works.length : '', '#1d2126', layer === 'print' && p.academic === 0, layer === 'print' ? 26 : 14)}>
              <Popup>
                <div className="min-w-48 max-w-72">
                  <div className="font-semibold text-gray-900">{p.label}</div>
                  <ul className="max-h-56 space-y-0.5 overflow-y-auto">
                    {p.works.map(w => (
                      <li key={w.work_id}>
                        {w.restricted
                          ? <span className="text-gray-500">{w.title} ({t('network.restricted')})</span>
                          : <Link to={`/work/${w.work_id}/1`} className="text-primary-700 hover:underline">{w.title.length > 70 ? `${w.title.slice(0, 69)}…` : w.title}</Link>}
                        {w.year ? <span className="ml-1 text-xs text-gray-400">{w.year}</span> : null}
                      </li>
                    ))}
                  </ul>
                </div>
              </Popup>
            </Marker>
          ))}
          {layer === 'life' && life.mapped.length > 1 && (
            <Polyline positions={life.mapped.map(s => [s.coords!.lat, s.coords!.lon] as [number, number])}
              pathOptions={{ color: '#1d2126', weight: 2, opacity: 0.6, dashArray: '6 4' }} />
          )}
          {layer === 'life' && spreadOverlapping(life.mapped, s => s.coords!).map(s => (
            <Marker key={s.n} position={[s.display.lat, s.display.lon]} icon={dotIcon(s.n!, '#1d2126')}>
              <Popup>
                <b>{s.n}. {t(`network.stations.${s.kind}`)}</b>{s.label ? ` · ${s.label}` : ''}
                <div className="text-xs text-gray-600">{s.placeLabel}{s.year ? ` · ${s.year}` : ''}</div>
              </Popup>
            </Marker>
          ))}
        </MapContainer>
      </div>
      {layer !== 'life' && layer !== 'print' && origin.unmapped.length > 0 && (
        <p className="text-xs text-gray-600">
          {t('network.unmappedPersons', { count: origin.unmapped.length })}: {origin.unmapped.slice(0, 14).map(p => p.label).join(', ')}
          {origin.unmapped.length > 14 ? ` …` : ''}
        </p>
      )}
      {layer === 'life' && (
        <div className="text-xs text-gray-600">
          {life.status === 'loading' && <p>{t('network.registryLoading')}</p>}
          {life.status === 'error' && <p className="text-red-600">{t('network.registryError')}</p>}
          {life.status === 'ready' && life.mapped.length === 0 && life.unmapped.length === 0 && <p>{t('network.noStations')}</p>}
          {life.mapped.length > 0 && (
            <ol className="list-decimal pl-5">
              {life.mapped.map(s => (
                <li key={s.n}>{t(`network.stations.${s.kind}`)}{s.label ? ` · ${s.label}` : ''} — {s.placeLabel}{s.year ? `, ${s.year}` : ''}</li>
              ))}
            </ol>
          )}
          {life.unmapped.length > 0 && (
            <div className="mt-2">
              <div className="font-semibold text-gray-700">{t('network.unmappedStations')}</div>
              <ul className="list-disc pl-5">
                {life.unmapped.map((s, i) => (
                  <li key={i}>
                    {t(`network.stations.${s.kind}`)}{s.label ? ` · ${s.label}` : ''}{s.placeLabel ? ` — ${s.placeLabel}` : ''}{s.year ? `, ${s.year}` : ''}
                    <span className="ml-1 text-gray-400">({t(`network.reasons.${s.reason}`)})</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default RelationsMap;
