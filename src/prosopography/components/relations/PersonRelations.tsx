// src/prosopography/components/relations/PersonRelations.tsx
/**
 * Isikulehe „Seosed" sektsioon (#461): üks päring GET /prosopography/{id}/network,
 * kolm vaadet (Võrgustik · Ajatelg · Loend), ühised filtrid, esiletõst ja hüpikaken.
 * Kogu lüliti: vaikimisi kogu ei piira (sama mis #460 seoste kaart).
 */
import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Waypoints, Map as MapIcon } from 'lucide-react';
import { useCollection } from '../../../contexts/CollectionContext';
import { fetchPersonNetwork, type PersonNetwork } from '../../services/networkService';
import { applyFilters, DEFAULT_FILTER, KIND_ORDER, type KindFilter } from '../../utils/network';
import { KindMark } from './kindStyle';
import RelationPopover, { usePopover } from './RelationPopover';
import RelationsGraph from './RelationsGraph';
import RelationsTimeline from './RelationsTimeline';
import RelationsTable from './RelationsTable';

type Tab = 'graph' | 'timeline' | 'table';
const TABS: Tab[] = ['graph', 'timeline', 'table'];

const PersonRelations: React.FC<{ personId: string }> = ({ personId }) => {
  const { t, i18n } = useTranslation(['prosopography']);
  const { selectedCollection, getCollectionName } = useCollection();
  // Andmed koos isikuga: kogu lüliti uuesti päring hoiab eelmise vaate alles, isiku vahetus mitte.
  const [loaded, setLoaded] = useState<{ personId: string; data: PersonNetwork } | null>(null);
  const [error, setError] = useState(false);
  const [filter, setFilter] = useState<KindFilter>(DEFAULT_FILTER);
  const [scoped, setScoped] = useState(false);
  const [tab, setTab] = useState<Tab>('graph');
  const [highlight, setHighlight] = useState<string | null>(null);
  const popover = usePopover();
  const collection = scoped ? selectedCollection : null;

  useEffect(() => {
    let cancelled = false;          // vana vastus ei kirjuta uue isiku oma üle
    setError(false);
    fetchPersonNetwork(personId, collection)
      .then(d => { if (!cancelled) setLoaded({ personId, data: d }); })
      .catch(() => { if (!cancelled) setError(true); });
    return () => { cancelled = true; };
  }, [personId, collection]);

  // Isiku vahetus: hüpik ja esiletõst ei tohi üle kanduda (remount ei lähtesta — sama komponent).
  useEffect(() => { popover.close(); setHighlight(null); }, [personId]); // eslint-disable-line react-hooks/exhaustive-deps

  const data = loaded && loaded.personId === personId ? loaded.data : null;
  const net = useMemo(() => (data ? applyFilters(data, filter) : null), [data, filter]);

  const lang = i18n.language === 'en' ? 'en' : 'et';
  const mapUrl = `/persons?view=map&related_to=${encodeURIComponent(personId)}`
    + (scoped && selectedCollection ? '&related_scope=collection' : '');

  const filters = (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-gray-600">
      {KIND_ORDER.map(k => (
        <span key={k} className="inline-flex items-center gap-1.5">
          <svg width={14} height={14} aria-hidden="true"><KindMark kind={k} r={5} x={7} y={7} /></svg>
          {k === 'cotext' || k === 'mention' || k === 'printer' ? (
            <label className="inline-flex cursor-pointer items-center gap-1">
              <input type="checkbox" checked={filter[k]} onChange={e => setFilter(f => ({ ...f, [k]: e.target.checked }))}
                aria-label={t(`network.kinds.${k}`)} />
              {t(`network.kinds.${k}`)}
            </label>
          ) : t(`network.kinds.${k}`)}
        </span>
      ))}
      {selectedCollection && (
        <label className="inline-flex cursor-pointer items-center gap-1.5">
          <input type="checkbox" checked={scoped} onChange={() => setScoped(s => !s)}
            aria-label={t('network.onlyInCollection', { name: getCollectionName(selectedCollection, lang) })} />
          {t('network.onlyInCollection', { name: getCollectionName(selectedCollection, lang) })}
        </label>
      )}
    </div>
  );

  // Veaolekus jääb filtririba alles — muidu ei saaks „Ainult kogus" lülitit tagasi keerata.
  if (error) return <Section mapUrl={mapUrl}>{filters}<p className="mt-3 text-sm text-red-600">{t('network.error')}</p></Section>;
  if (!net) return null;

  if (net.persons.length === 0) {
    return <Section mapUrl={mapUrl}>{filters}<p className="mt-3 text-sm text-gray-500">{t('network.empty')}</p></Section>;
  }

  return (
    <Section mapUrl={mapUrl} count={net.persons.length}>
      {filters}
      <div role="tablist" className="mt-3 flex gap-1 border-b border-gray-100">
        {TABS.map(k => (
          <button key={k} role="tab" type="button" aria-selected={tab === k} onClick={() => setTab(k)}
            className={`-mb-px border-b-2 px-3 py-1.5 text-sm ${tab === k ? 'border-primary-600 text-primary-700' : 'border-transparent text-gray-500 hover:text-gray-800'}`}>
            {t(`network.tabs.${k}`)}
          </button>
        ))}
      </div>
      <div className="mt-3">
        {tab === 'graph' && <RelationsGraph net={net} popover={popover} highlight={highlight} onHighlight={setHighlight} />}
        {tab === 'timeline' && <RelationsTimeline net={net} popover={popover} highlight={highlight} onHighlight={setHighlight} />}
        {tab === 'table' && <RelationsTable net={net} />}
      </div>
      <RelationPopover state={popover.state} net={net} onClose={popover.close} />
    </Section>
  );
};

const Section: React.FC<{ children: React.ReactNode; mapUrl?: string; count?: number }> = ({ children, mapUrl, count }) => {
  const { t } = useTranslation(['prosopography']);
  return (
    <div className="mb-6 rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
      <div className="mb-3 flex items-center gap-2 border-b border-gray-100 pb-2 text-gray-800">
        <span className="text-primary-600"><Waypoints size={18} /></span>
        <h4 className="font-bold">{t('network.title')}</h4>
        {count !== undefined && <span className="text-xs font-normal text-gray-400">({count})</span>}
        {mapUrl && (
          <Link to={mapUrl} className="ml-auto flex items-center gap-1 text-xs text-gray-500 hover:text-primary-700">
            <MapIcon size={12} /> {t('network.openMap')}
          </Link>
        )}
      </div>
      {children}
    </div>
  );
};

export default PersonRelations;
