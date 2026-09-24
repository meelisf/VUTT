/**
 * Uue teose sihtkogud upload-viisardis: püsikogu(d) + töökollektsioonid.
 *
 * Kaks eri asja ühes valijas, sest kasutaja jaoks on mõlemad „kuhu see teos
 * läheb". Andmemudelis on nad lahus: püsikogu on teose omadus
 * (`_metadata.json` → `collections`), töökollektsioon on kogu omadus
 * (ADR 0042) — liikmesuse kirjutab server alles impordil.
 *
 * Töökollektsioonidest näidatakse ainult neid, kuhu kutsuja tohib lisada
 * (`manageableWorkSets`) — sama reegel, mis impordil (`add_work_to_sets`).
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, ChevronDown, FolderOpen, Library, Search, Users } from 'lucide-react';
import { useCollection } from '../contexts/CollectionContext';
import { buildCollectionTree, CollectionTreeNode, Collections } from '../services/collectionService';
import { buildPickerEntries, favoriteEntries, manageableWorkSets, Nimi } from './pickerEntries';
import { useFavoriteCollections } from '../hooks/useFavoriteCollections';
import FavoriteStar from './FavoriteStar';

interface CollectionTargetSelectProps {
  collections: Collections;
  selectedCollections: string[];
  onCollectionsChange: (next: string[]) => void;
  /** Samm 1 lubab ühe püsikogu (raadio), metaandmete vorm mitu (linnuke). */
  multipleCollections?: boolean;
  selectedWorkSets: string[];
  onWorkSetsChange: (next: string[]) => void;
  label: string;
  lang: 'et' | 'en';
}

const nimi = (n: Nimi, lang: 'et' | 'en', id: string) => n[lang] || n.et || n.en || id;

/** Valikunäidik: raadio (üks püsikogu) või linnuke (mitu). */
const Naidik: React.FC<{ valitud: boolean; ruut: boolean }> = ({ valitud, ruut }) => (
  <span
    className={`shrink-0 w-4 h-4 flex items-center justify-center border ${ruut ? 'rounded' : 'rounded-full'}
      ${valitud ? 'bg-primary-600 border-primary-600 text-white' : 'border-gray-300 bg-white'}`}
  >
    {valitud && <Check size={12} strokeWidth={3} />}
  </span>
);

const CollectionTargetSelect: React.FC<CollectionTargetSelectProps> = ({
  collections,
  selectedCollections,
  onCollectionsChange,
  multipleCollections = false,
  selectedWorkSets,
  onWorkSetsChange,
  label,
  lang,
}) => {
  const { t } = useTranslation(['common']);
  const { workSets } = useCollection();
  const fav = useFavoriteCollections();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const ref = useRef<HTMLDivElement>(null);

  // Sulge väljaspool klikkides või Esc-ga
  useEffect(() => {
    if (!open) return;
    const klikk = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const klahv = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', klikk);
    document.addEventListener('keydown', klahv);
    return () => {
      document.removeEventListener('mousedown', klikk);
      document.removeEventListener('keydown', klahv);
    };
  }, [open]);

  const tree = useMemo(() => buildCollectionTree(collections), [collections]);
  const lisatavad = useMemo(() => manageableWorkSets(workSets, '', lang), [workSets, lang]);
  const { permanent } = useMemo(
    () => buildPickerEntries(tree, [], query, lang),
    [tree, query, lang],
  );
  const nahtavadKogud = useMemo(() => manageableWorkSets(workSets, query, lang), [workSets, query, lang]);
  const lemmikud = useMemo(
    () => favoriteEntries(fav.favorites, tree, lisatavad, query, lang),
    [fav.favorites, tree, lisatavad, query, lang],
  );

  const kogudValitud = new Set(selectedCollections);
  const tooKogudValitud = new Set(selectedWorkSets);

  const valiKogu = (id: string | null) => {
    if (!multipleCollections) {
      onCollectionsChange(id ? [id] : []);
      return;
    }
    if (!id) return;
    onCollectionsChange(kogudValitud.has(id)
      ? selectedCollections.filter(c => c !== id)
      : [...selectedCollections, id]);
  };
  const valiTooKogu = (id: string) => {
    onWorkSetsChange(tooKogudValitud.has(id)
      ? selectedWorkSets.filter(w => w !== id)
      : [...selectedWorkSets, id]);
  };

  // Kokkuvõte nupul. Töökollektsiooni nimi tuleb laetud loendist — kui kogu
  // on vahepeal kustutatud, näidatakse id-d (server jätab ta impordil vahele).
  const kogudeNimed = selectedCollections.map(id => {
    const c = collections[id];
    return c ? nimi(c.name, lang, id) : id;
  });
  const tooKoguNimed = selectedWorkSets.map(id => {
    const ws = workSets.find(w => w.id === id);
    return ws ? nimi(ws.name, lang, id) : id;
  });

  const taht = (kind: 'collection' | 'work_set', id: string) => fav.enabled && (
    <FavoriteStar
      active={fav.isFavorite(kind, id)}
      onToggle={() => fav.toggle(kind, id)}
      disabled={fav.busy}
    />
  );

  const reaKlass = 'w-full flex items-center gap-2 px-2 py-1.5 rounded text-left text-sm hover:bg-gray-100';

  // Tavalised renderdusfunktsioonid, MITTE komponendid: sisemine komponent
  // oleks iga renderdusega uus tüüp ja React monteeriks read uuesti.
  const koguRida = (node: CollectionTreeNode, depth: number): React.ReactNode => (
    <React.Fragment key={node.id}>
      <div className="flex items-center gap-1" style={{ paddingLeft: depth * 16 }}>
        <button type="button" onClick={() => valiKogu(node.id)} className={reaKlass}>
          <Naidik valitud={kogudValitud.has(node.id)} ruut={multipleCollections} />
          <FolderOpen size={15} className="shrink-0 text-gray-400" />
          <span className="flex-1 truncate">{nimi(node.collection.name, lang, node.id)}</span>
        </button>
        {taht('collection', node.id)}
      </div>
      {node.children.map(child => koguRida(child, depth + 1))}
    </React.Fragment>
  );

  const tooKoguRida = (ws: { id: string; name: Nimi }, key: string): React.ReactNode => (
    <div key={key} className="flex items-center gap-1">
      <button type="button" onClick={() => valiTooKogu(ws.id)} className={reaKlass}>
        <Naidik valitud={tooKogudValitud.has(ws.id)} ruut />
        <Users size={15} className="shrink-0 text-gray-400" />
        <span className="flex-1 truncate">{nimi(ws.name, lang, ws.id)}</span>
      </button>
      {taht('work_set', ws.id)}
    </div>
  );

  const pealkiri = (tekst: string) => (
    <h4 className="px-2 pt-2 pb-1 text-[11px] font-semibold uppercase tracking-wide text-gray-500">
      {tekst}
    </h4>
  );

  const tuhi = !query.trim() ? null : t('workSets.noMatches', 'Ükski kogu ei vasta otsingule');

  return (
    <div ref={ref} className="relative">
      <label className="block text-sm font-medium text-gray-700 mb-1">{label}</label>
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        aria-expanded={open}
        className="w-full flex items-center justify-between gap-2 border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white hover:border-gray-400 focus:outline-none focus:ring-2 focus:ring-primary-500 text-left"
      >
        <span className="flex-1 min-w-0 flex flex-wrap gap-x-3 gap-y-0.5">
          {kogudeNimed.length === 0 && tooKoguNimed.length === 0 && (
            <span className="text-gray-400">{t('workSets.targetPlaceholder', '— vali kollektsioon —')}</span>
          )}
          {kogudeNimed.length > 0 && (
            <span className="flex items-center gap-1 text-gray-800 min-w-0">
              <Library size={14} className="shrink-0 text-gray-400" />
              <span className="truncate">{kogudeNimed.join(', ')}</span>
            </span>
          )}
          {tooKoguNimed.length > 0 && (
            <span className="flex items-center gap-1 text-gray-800 min-w-0">
              <Users size={14} className="shrink-0 text-gray-400" />
              <span className="truncate">{tooKoguNimed.join(', ')}</span>
            </span>
          )}
        </span>
        <ChevronDown size={16} className={`shrink-0 text-gray-400 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="absolute z-50 mt-1 w-full bg-white border border-gray-200 rounded-lg shadow-lg flex flex-col max-h-96">
          <div className="p-2 border-b border-gray-100">
            <div className="relative">
              <Search size={15} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                type="text"
                autoFocus
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t('workSets.search', 'Otsi kogu nime järgi')}
                className="w-full pl-8 pr-3 py-1.5 border border-gray-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
              />
            </div>
            {fav.error && (
              <p className="text-xs text-red-600 mt-1">{t('workSets.favoriteFailed', 'Lemmiku salvestamine ebaõnnestus')}</p>
            )}
          </div>

          <div className="overflow-y-auto p-1">
            {lemmikud.length > 0 && (
              <>
                {pealkiri(t('workSets.favorites', 'Lemmikud'))}
                {lemmikud.map(e => e.kind === 'collection'
                  ? (
                    <div key={`c:${e.id}`} className="flex items-center gap-1">
                      <button type="button" onClick={() => valiKogu(e.id)} className={reaKlass}>
                        <Naidik valitud={kogudValitud.has(e.id)} ruut={multipleCollections} />
                        <FolderOpen size={15} className="shrink-0 text-gray-400" />
                        <span className="flex-1 truncate">{nimi(e.name, lang, e.id)}</span>
                      </button>
                      {taht('collection', e.id)}
                    </div>
                  )
                  : tooKoguRida(e, `s:${e.id}`))}
                <div className="border-t border-gray-100 my-1" />
              </>
            )}

            {pealkiri(t('workSets.permanent', 'Püsikogud'))}
            {!multipleCollections && !query.trim() && (
              <button type="button" onClick={() => valiKogu(null)} className={reaKlass}>
                <Naidik valitud={selectedCollections.length === 0} ruut={false} />
                <span className="flex-1 text-gray-500">{t('workSets.noCollection', 'Kollektsioonita')}</span>
              </button>
            )}
            {permanent.length === 0
              ? <p className="px-2 py-1.5 text-sm text-gray-500">{tuhi ?? t('collections.empty', 'Kollektsioone pole veel lisatud')}</p>
              : permanent.map(node => koguRida(node, 0))}

            <div className="border-t border-gray-100 my-1" />
            {pealkiri(t('workSets.section', 'Töökollektsioonid'))}
            {nahtavadKogud.length === 0
              ? <p className="px-2 py-1.5 text-sm text-gray-500">{tuhi ?? t('workSets.noManageable', 'Sa ei halda ühtki aktiivset töökollektsiooni')}</p>
              : nahtavadKogud.map(ws => tooKoguRida(ws, ws.id))}
          </div>
        </div>
      )}
    </div>
  );
};

export default CollectionTargetSelect;
