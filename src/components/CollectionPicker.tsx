import React, { useState, useMemo, useEffect, useRef } from 'react';
import { isAtLeast } from '../utils/roleUtils';
import { useTranslation } from 'react-i18next';
import { Library, ChevronRight, ChevronDown, X, Check, FolderOpen, Search, Users, Plus, Loader2 } from 'lucide-react';
import { useCollection } from '../contexts/CollectionContext';
import { useUser } from '../contexts/UserContext';
import { buildCollectionTree, CollectionTreeNode, getCollectionColorClasses } from '../services/collectionService';
import { buildPickerEntries, favoriteEntries } from './pickerEntries';
import { useFavoriteCollections } from '../hooks/useFavoriteCollections';
import FavoriteStar from './FavoriteStar';
import { createWorkSet } from '../services/workSetService';
import { CollectionSelection } from '../services/selectionFilter';
import { getLangCode } from '../utils/getLangCode';
import { isSessionExpired } from '../utils/apiErrorText';

interface CollectionPickerProps {
  // Variant 1: Headeris kasutatav (globaalne kontekst)
  isOpen?: boolean;
  onClose: () => void;
  // Variant 2: Massiline määramine (callback põhine)
  onSelect?: (collectionId: string | null) => void;
  showUnassigned?: boolean;  // Näita "Määramata" valikut
  title?: string;  // Kohandatud pealkiri
}

// Rekursiivne puuvaate komponent
const TreeNode: React.FC<{
  node: CollectionTreeNode;
  level: number;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  lang: 'et' | 'en';
  expandedIds: Set<string>;
  toggleExpanded: (id: string) => void;
  /** Otsingu ajal: vaste ei tohi kokkuklapitud vanema taha peitu jääda. */
  forceExpanded?: boolean;
  /** Lemmiku tärn rea lõpus (puudub, kui kasutaja pole sisse logitud). */
  star?: (id: string) => React.ReactNode;
}> = ({ node, level, selectedId, onSelect, lang, expandedIds, toggleExpanded, forceExpanded, star }) => {
  const isExpanded = forceExpanded || expandedIds.has(node.id);
  const hasChildren = node.children.length > 0;
  const isSelected = selectedId === node.id;
  const colorClasses = getCollectionColorClasses(node.collection);

  return (
    <div>
      <div
        className={`
          w-full flex items-center gap-2 px-3 py-2 rounded-lg text-left transition-colors
          ${isSelected ? `${colorClasses.bg} ${colorClasses.text}` : 'hover:bg-gray-100'}
        `}
        style={{ paddingLeft: `${12 + level * 20}px` }}
      >
        {/* Laiendamise nupp - eraldi klõpsatav ala */}
        {hasChildren ? (
          <button
            onClick={(e) => {
              e.stopPropagation();
              toggleExpanded(node.id);
            }}
            className="w-5 h-5 flex items-center justify-center text-gray-400 hover:text-gray-600 hover:bg-gray-200 rounded transition-colors"
          >
            {isExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
          </button>
        ) : (
          <span className="w-5" />
        )}

        {/* Valimise ala - kausta ikoon + nimi */}
        <button
          onClick={() => onSelect(node.id)}
          className="flex items-center gap-2 flex-1 min-w-0"
        >
          <FolderOpen size={18} className={isSelected ? colorClasses.text : 'text-gray-400'} />
          <span className="flex-1 truncate text-left">
            {node.collection.name[lang] || node.collection.name.et}
          </span>
          {isSelected && <Check size={18} className={colorClasses.text} />}
        </button>
        {star?.(node.id)}
      </div>

      {/* Alamad */}
      {isExpanded && hasChildren && (
        <div>
          {node.children.map((child) => (
            <TreeNode
              key={child.id}
              node={child}
              level={level + 1}
              selectedId={selectedId}
              onSelect={onSelect}
              lang={lang}
              expandedIds={expandedIds}
              toggleExpanded={toggleExpanded}
              forceExpanded={forceExpanded}
              star={star}
            />
          ))}
        </div>
      )}
    </div>
  );
};

const CollectionPicker: React.FC<CollectionPickerProps> = ({
  isOpen = true,  // Default true kui kasutatakse callback variandina
  onClose,
  onSelect,
  showUnassigned = false,
  title
}) => {
  const { t, i18n } = useTranslation(['common']);
  const { selection, setSelection, collections, workSets, workSetsError, refreshWorkSets } = useCollection();
  // Massilise määramise variandis (`onSelect`) valitakse teosele PÜSIKOGU;
  // töökollektsioon ei ole teose omadus, seega seal seda jaotist ei ole.
  const selectedCollection = selection.kind === 'collection' ? selection.id : null;
  const [query, setQuery] = useState('');
  // Loomine päise valijast (spekk §1.2) — admin ei pea selleks /admin/ alla minema.
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [createBusy, setCreateBusy] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const { user } = useUser();
  const lang = getLangCode(i18n.language);

  // Filtreeri kollektsioonid kasutaja ligipääsu järgi
  const visibleCollections = useMemo(() => {
    if (isAtLeast(user?.role, 'admin')) return collections;
    const allowed = new Set(user?.allowed_collections ?? []);
    return Object.fromEntries(
      Object.entries(collections).filter(([id, col]) =>
        (col as any).visibility !== 'restricted' || allowed.has(id)
      )
    );
  }, [collections, user]);

  // Laiendatud sõlmed. Vaikimisi on kõik tippkollektsioonid lahti.
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  // `Header` monteerib valija TINGIMUSTETA (`isOpen` juhib ainult
  // `return null`-i), seega mount toimub enne, kui kogud on üle võrgu kohal.
  // `useState`-i initsialiseerija jookseb täpselt siis — tühja objekti peal —
  // ja jättis laiendatud hulga tühjaks (#319). Seemenda esimesel korral, kui
  // kogud päriselt saabuvad.
  const seemendatud = useRef(false);
  useEffect(() => {
    if (seemendatud.current) return;
    const juured = Object.entries(visibleCollections)
      .filter(([, col]) => !col.parent)
      .map(([id]) => id);
    if (juured.length === 0) return;
    // Seemendus on ÜHEKORDNE: hiljem saabuv kogu ei tohi kasutaja
    // kokkuklapitud haru uuesti lahti kangutada.
    seemendatud.current = true;
    setExpandedIds(new Set(juured));
  }, [visibleCollections]);

  // Ehita puu
  const tree = useMemo(() => buildCollectionTree(visibleCollections), [visibleCollections]);
  const { permanent, workSets: nahtavadKogud } = useMemo(
    () => buildPickerEntries(tree, onSelect ? [] : workSets, query, lang),
    [tree, workSets, query, lang, onSelect],
  );
  const fav = useFavoriteCollections();
  // Lemmikud tulevad samast nähtavast hulgast: täht ei tohi avada kogu, mida
  // valija muidu ei näitaks. Massilise määramise variandis ainult püsikogud.
  const lemmikud = useMemo(
    () => favoriteEntries(fav.favorites, tree, nahtavadKogud, query, lang),
    [fav.favorites, tree, nahtavadKogud, query, lang],
  );
  const star = fav.enabled
    ? (kind: 'collection' | 'work_set', id: string) => (
      <FavoriteStar
        active={fav.isFavorite(kind, id)}
        onToggle={() => fav.toggle(kind, id)}
        disabled={fav.busy}
      />
    )
    : null;
  const collectionStar = star ? (id: string) => star('collection', id) : undefined;
  // Otsingu ajal peavad vasted olema NÄHTAVAD: kokkuklapitud vanem peidaks
  // just selle lapse, mille kasutaja otsis.
  const otsib = query.trim().length > 0;

  const toggleExpanded = (id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const handleSelect = (id: string | null) => {
    if (onSelect) {
      // Callback variant (massiline määramine)
      onSelect(id);
    } else {
      // Globaalse konteksti variant (header)
      setSelection(id ? { kind: 'collection', id } : { kind: 'all' });
    }
    onClose();
  };

  const handleSelectSet = (next: CollectionSelection) => {
    setSelection(next);
    onClose();
  };

  const handleCreate = async () => {
    const nimi = newName.trim();
    if (!nimi) return;
    setCreateBusy(true);
    setCreateError(null);
    try {
      const ws = await createWorkSet({ et: nimi, en: nimi });
      await refreshWorkSets();
      // Loomise järel valitakse uus kogu kohe aktiivseks: kuraator lõi ta
      // selleks, et temaga tööle hakata.
      handleSelectSet({ kind: 'work_set', id: ws.id });
    } catch {
      setCreateError(t('workSets.createFailed', 'Loomine ebaõnnestus'));
    } finally {
      setCreateBusy(false);
    }
  };

  if (!isOpen) return null;

  return (
    // Päis on `sticky z-[1200]` — `z-50` jättis modaali ülemise serva (ja
    // sulgemisnupu) väikesel ekraanil päise alla.
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[1300]">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-md mx-4 overflow-hidden max-h-[80vh] flex flex-col">
        {/* Header */}
        <div className="bg-primary-600 px-6 py-4 flex items-center justify-between">
          <h2 className="text-xl font-bold text-white flex items-center gap-2">
            <Library size={24} />
            {title || t('collections.title', 'Vali kollektsioon')}
          </h2>
          <button
            onClick={onClose}
            className="text-white/80 hover:text-white transition-colors"
          >
            <X size={24} />
          </button>
        </div>

        {/* Ühine otsinguväli — filtreerib mõlemat jaotist korraga */}
        <div className="px-4 pt-4">
          <div className="relative">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t('workSets.search', 'Otsi kogu nime järgi')}
              className="w-full pl-9 pr-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
            />
          </div>
        </div>

        {/* Sisu */}
        <div className="flex-1 overflow-y-auto p-4">
          {/* "Kõik tööd" valik - ainult headeris */}
          {!onSelect && (
            <>
              <button
                onClick={() => handleSelect(null)}
                className={`
                  w-full flex items-center gap-2 px-3 py-2 rounded-lg text-left transition-colors mb-2
                  ${selection.kind === 'all' ? 'bg-primary-100 text-primary-800' : 'hover:bg-gray-100'}
                `}
              >
                <span className="w-5" />
                <Library size={18} className={selection.kind === 'all' ? 'text-primary-600' : 'text-gray-400'} />
                <span className="flex-1">{t('collections.all', 'Kõik tööd')}</span>
                {selection.kind === 'all' && <Check size={18} className="text-primary-600" />}
              </button>
              <div className="border-t border-gray-200 my-2" />
            </>
          )}

          {/* "Määramata" valik - massilise määramise puhul */}
          {showUnassigned && (
            <>
              <button
                onClick={() => handleSelect(null)}
                className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-left transition-colors mb-2 hover:bg-amber-50 text-amber-700"
              >
                <span className="w-5" />
                <FolderOpen size={18} className="text-amber-500" />
                <span className="flex-1">{t('collections.unassigned', 'Määramata (eemalda kollektsioon)')}</span>
              </button>
              <div className="border-t border-gray-200 my-2" />
            </>
          )}

          {/* Lemmikud — mõlemad liigid koos, täispuu jääb allapoole muutmata */}
          {lemmikud.length > 0 && (
            <>
              <h3 className="px-3 pb-1 text-xs font-semibold uppercase tracking-wide text-gray-500">
                {t('workSets.favorites', 'Lemmikud')}
              </h3>
              {lemmikud.map((e) => {
                const isSelected = e.kind === 'collection'
                  ? selectedCollection === e.id
                  : selection.kind === 'work_set' && selection.id === e.id;
                const Icon = e.kind === 'collection' ? FolderOpen : Users;
                return (
                  <div
                    key={`${e.kind}:${e.id}`}
                    className={`flex items-center gap-2 px-3 py-2 rounded-lg transition-colors
                      ${isSelected ? 'bg-primary-100 text-primary-800' : 'hover:bg-gray-100'}`}
                  >
                    <span className="w-5" />
                    <button
                      onClick={() => (e.kind === 'collection'
                        ? handleSelect(e.id)
                        : handleSelectSet({ kind: 'work_set', id: e.id }))}
                      className="flex items-center gap-2 flex-1 min-w-0 text-left"
                    >
                      <Icon size={18} className={isSelected ? 'text-primary-600' : 'text-gray-400'} />
                      <span className="flex-1 truncate">{e.name[lang] || e.name.et || e.name.en || e.id}</span>
                      {isSelected && <Check size={18} className="text-primary-600" />}
                    </button>
                    {star?.(e.kind, e.id)}
                  </div>
                );
              })}
              {fav.error && (
                <p className="px-3 text-xs text-red-600">{t('workSets.favoriteFailed', 'Lemmiku salvestamine ebaõnnestus')}</p>
              )}
              <div className="border-t border-gray-200 my-2" />
            </>
          )}

          {/* Püsikogud */}
          {!onSelect && (
            <h3 className="px-3 pb-1 text-xs font-semibold uppercase tracking-wide text-gray-500">
              {t('workSets.permanent', 'Püsikogud')}
            </h3>
          )}
          {permanent.length === 0 ? (
            <p className="text-gray-500 text-center py-8">
              {otsib
                ? t('workSets.noMatches', 'Ükski kogu ei vasta otsingule')
                : t('collections.empty', 'Kollektsioone pole veel lisatud')}
            </p>
          ) : (
            permanent.map((node) => (
              <TreeNode
                key={node.id}
                node={node}
                level={0}
                selectedId={selectedCollection}
                onSelect={handleSelect}
                lang={lang}
                expandedIds={expandedIds}
                toggleExpanded={toggleExpanded}
                forceExpanded={otsib}
                star={collectionStar}
              />
            ))
          )}

          {/* Töökollektsioonid — ainult päise variandis (globaalne töökontekst) */}
          {!onSelect && (
            <>
              <div className="border-t border-gray-200 my-3" />
              <h3 className="px-3 pb-1 text-xs font-semibold uppercase tracking-wide text-gray-500">
                {t('workSets.section', 'Töökollektsioonid')}
              </h3>
              {isAtLeast(user?.role, 'admin') && (
                creating ? (
                  <div className="px-3 pb-2">
                    <div className="flex gap-2">
                      <input
                        type="text"
                        autoFocus
                        value={newName}
                        onChange={(e) => setNewName(e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Enter') handleCreate(); }}
                        placeholder={t('workSets.createName', 'Uue töökollektsiooni nimi')}
                        className="flex-1 min-w-0 px-2 py-1 border border-gray-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                      />
                      <button
                        onClick={handleCreate}
                        disabled={!newName.trim() || createBusy}
                        className="px-2 py-1 bg-primary-600 text-white rounded text-sm disabled:opacity-50"
                      >
                        {createBusy ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
                      </button>
                      <button
                        onClick={() => { setCreating(false); setNewName(''); setCreateError(null); }}
                        className="px-2 py-1 text-gray-500 hover:text-gray-700"
                      >
                        <X size={14} />
                      </button>
                    </div>
                    {createError && <p className="text-xs text-red-600 mt-1">{createError}</p>}
                  </div>
                ) : (
                  <button
                    onClick={() => setCreating(true)}
                    className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-left text-sm text-primary-700 hover:bg-primary-50 transition-colors"
                  >
                    <span className="w-5" />
                    <Plus size={16} />
                    {t('workSets.create', 'Loo töökollektsioon')}
                  </button>
                )
              )}
              {nahtavadKogud.length === 0 ? (
                <p className="px-3 py-2 text-sm text-gray-500">
                  {/* Laadimata loend ei ole tühi loend: „ei ole" ütleks
                      aegunud sessiooni korral, et kogud on kadunud. */}
                  {workSetsError
                    ? (isSessionExpired(workSetsError)
                      ? t('common:errors.sessionExpired')
                      : t('workSets.loadFailed', 'Töökollektsioonide laadimine ebaõnnestus'))
                    : otsib
                      ? t('workSets.noMatches', 'Ükski kogu ei vasta otsingule')
                      : t('workSets.empty', 'Töökollektsioone ei ole')}
                </p>
              ) : (
                nahtavadKogud.map((ws) => {
                  const isSelected = selection.kind === 'work_set' && selection.id === ws.id;
                  return (
                    <div
                      key={ws.id}
                      className={`
                        flex items-center gap-2 px-3 py-2 rounded-lg transition-colors
                        ${isSelected ? 'bg-primary-100 text-primary-800' : 'hover:bg-gray-100'}
                      `}
                    >
                      <span className="w-5" />
                      <button
                        onClick={() => handleSelectSet({ kind: 'work_set', id: ws.id })}
                        className="flex items-center gap-2 flex-1 min-w-0 text-left"
                      >
                        <Users size={18} className={isSelected ? 'text-primary-600' : 'text-gray-400'} />
                        <span className="flex-1 truncate">
                          {ws.name[lang] || ws.name.et || ws.name.en || ws.id}
                        </span>
                        {isSelected && <Check size={18} className="text-primary-600" />}
                      </button>
                      {star?.('work_set', ws.id)}
                    </div>
                  );
                })
              )}
            </>
          )}
        </div>

        {/* Footer */}
        <div className="border-t border-gray-200 px-6 py-3 bg-gray-50">
          <p className="text-xs text-gray-500 text-center">
            {t('collections.hint', 'Valik salvestub ja kehtib kõigis vaadetes')}
          </p>
        </div>
      </div>
    </div>
  );
};

export default CollectionPicker;
