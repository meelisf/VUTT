/**
 * AdvancedFilters - Täpsemad filtrid Dashboard ja SearchPage jaoks
 *
 * Allaklapitav paneel, mis sisaldab:
 * - Staatuse filter (teose_staatus)
 * - Žanri filter (genre)
 * - Märksõnade filter (tags/teose_tags)
 * - Tüübi filter (type)
 */
import React, { useState, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronDown, ChevronRight, Tag, Bookmark, FileType, CircleDot, Search, X } from 'lucide-react';
import { getLangCode } from '../utils/getLangCode';
import { isVuttId } from '../utils/qcodeUtils';
import { FacetDistribution } from '../services/searchService';
import { getVocabularies, Vocabularies } from '../services/collectionService';
import { mergeFacetItems, FilterItem } from '../utils/facetUtils';
import { resolveFilterValue, resolveItemValue } from '../utils/filterNormalization';

type WorkStatus = 'Toores' | 'Töös' | 'Valmis';

interface AdvancedFiltersProps {
  // Valitud väärtused
  selectedGenre: string | null;
  selectedTags: string[];
  selectedType: string | null;
  selectedStatus: WorkStatus | null;
  // Muutmise käsitlejad
  onGenreChange: (genre: string | null) => void;
  onTagsChange: (tags: string[]) => void;
  onTypeChange: (type: string | null) => void;
  onStatusChange: (status: WorkStatus | null) => void;
  // Valikuline: kas panna alguses lahti
  defaultExpanded?: boolean;
  // Dünaamilised facetid otsingutulemustest (live counts)
  facets?: FacetDistribution;
  // Q-kood → praeguse keele label kaart (Wikidata žanride jaoks)
  genreIdMap?: Record<string, string>;
  // Label → Q-kood kaart (žanrite jaoks, Wikidatas muutunud labelite ühendamiseks)
  genreLabelToId?: Record<string, string>;
  // Q-kood → praeguse keele label kaart (Wikidata märksõnade jaoks)
  tagsIdMap?: Record<string, string>;
  // Label → Q-kood kaart (märksõnade jaoks, facet merging)
  tagsLabelToId?: Record<string, string>;
  // Q-kood → praeguse keele label kaart (Wikidata tüüpide jaoks)
  typeIdMap?: Record<string, string>;
  // Label → Q-kood kaart (tüüpide jaoks)
  typeLabelToId?: Record<string, string>;
  // Keel facetide jaoks
  lang?: 'et' | 'en';
  // Enriched labels cache fallback-ina Q-koodide lahendamiseks
  enrichedLabels?: Record<string, Record<string, string>>;
}

interface FilterSectionProps {
  title: string;
  icon: React.ReactNode;
  items: FilterItem[];
  selectedValues: string[];
  onToggle: (value: string) => void;
  searchPlaceholder: string;
  getUnselectedClass?: (value: string) => string;
}

const FilterSection: React.FC<FilterSectionProps> = ({
  title,
  icon,
  items,
  selectedValues,
  onToggle,
  searchPlaceholder,
  getUnselectedClass
}) => {
  const { t } = useTranslation(['dashboard', 'common']);
  const [searchQuery, setSearchQuery] = useState('');
  const showSearch = items.length > 8;

  const filteredItems = useMemo(() => {
    if (!searchQuery) return items;
    const lowerQuery = searchQuery.toLowerCase();
    return items.filter(item => 
      item.label.toLowerCase().includes(lowerQuery)
    );
  }, [items, searchQuery]);

  return (
    <div>
      <h4 className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-1.5 flex items-center gap-1.5">
        <span className="text-primary-600">{icon}</span>
        {title}
      </h4>
      
      {showSearch && (
        <div className="relative mb-1.5">
          <div className="absolute inset-y-0 left-0 pl-2 flex items-center pointer-events-none">
            <Search size={14} className="text-gray-400" />
          </div>
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={searchPlaceholder}
            className="w-full pl-8 pr-3 py-1 text-sm border border-gray-200 rounded-md focus:outline-none focus:ring-1 focus:ring-primary-500 bg-white/50"
          />
        </div>
      )}

      <div className="max-h-32 overflow-y-auto custom-scrollbar pr-1">
        <div className="flex flex-wrap gap-2">
          {filteredItems.length === 0 ? (
            <span className="text-sm text-gray-400 italic py-1">{t('common:labels.noMatches')}</span>
          ) : (
            filteredItems.map(({ value, label, count }) => {
              const isSelected = selectedValues.includes(value);
              return (
                <button
                  key={value}
                  onClick={() => onToggle(value)}
                  className={`px-3 py-1 rounded-full text-sm font-medium transition-colors text-left ${
                    isSelected
                      ? 'bg-primary-600 text-white'
                      : (getUnselectedClass ? getUnselectedClass(value) : 'bg-gray-100 text-gray-700 hover:bg-gray-200')
                  }`}
                >
                  {label} <span className="opacity-60 text-xs">({count})</span>
                </button>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
};

const AdvancedFilters: React.FC<AdvancedFiltersProps> = ({
  selectedGenre,
  selectedTags,
  selectedType,
  selectedStatus,
  onGenreChange,
  onTagsChange,
  onTypeChange,
  onStatusChange,
  defaultExpanded = false,
  facets,
  genreIdMap,
  genreLabelToId,
  tagsIdMap,
  tagsLabelToId,
  typeIdMap,
  typeLabelToId,
  lang: propLang,
  enrichedLabels
}) => {
  const { t, i18n } = useTranslation(['dashboard', 'common']);
  const lang = propLang || getLangCode(i18n.language);
  const [isExpanded, setIsExpanded] = useState(defaultExpanded);

  // Sõnavara state (tõlked)
  const [vocabularies, setVocabularies] = useState<Vocabularies | null>(null);
  const [vocabLoading, setVocabLoading] = useState(true);

  // Staatuse valikud (fikseeritud, mitte facet)
  const statusOptions: WorkStatus[] = ['Toores', 'Töös', 'Valmis'];

  // Kontrolli, kas facetid on laetud (props kaudu)
  const hasFacets = facets && Object.keys(facets).length > 0;
  const loading = vocabLoading || !hasFacets;

  // Lae sõnavara (ainult tõlked, mitte facetid)
  useEffect(() => {
    const loadVocabularies = async () => {
      try {
        const vocabs = await getVocabularies();
        setVocabularies(vocabs);
      } catch (e) {
        console.warn('Sõnavara laadimine ebaõnnestus:', e);
      } finally {
        setVocabLoading(false);
      }
    };
    loadVocabularies();
  }, []);

  // ─────────────────────────────────────────────────────────────────────
  // crossLangTypeMap / crossLangGenreMap — MIKS NEID EI EEMALDATA (issue #18)
  // ─────────────────────────────────────────────────────────────────────
  // Need on label→label keelteülsed tõlketabelid (nt "Jutlus" → "Sermon"):
  // teise keele label → praeguse keele label. Need on `resolveFilterValue`
  // VIIMANE fallback (vt src/utils/filterNormalization.ts) ja aktiveeruvad
  // AINULT siis, kui selectedValue on LABEL (mitte Q-kood) — st vana või
  // jagatud URL ?genre=Jutlus avatakse teises keeles UI-s.
  //
  // Varasem TODO ("eemaldatav kui kõigil teostel type_ids/genre_ids indekseeritud")
  // EI OLE kehtiv — see segas kaks sõltumatut asja:
  //  1. Facetide keeleneutraalsus (genre_ids Q-koodid vs genre_et/genre_en) —
  //     lahendatud juba migratsiooniga 78bb94c. Sellest sõltub facetite
  //     duplikaatide vältimine.
  //  2. CrossLang-map — lahendab label-SISENDI keelt (vanad URL-id). Sellest
  //     EI sõltu andmete terviklus; type_ids/genre_ids terviklus on asjasse
  //     puutumatu eeltingimus. (Tegelikult pole see isegi saavutatav: 16 teosel
  //     on tühi type_ids ja 33-l tühi genre_ids, sest neil puudub tüüp/žanr
  //     lähtemetaandmetes — reindeks ei aita.)
  //
  // Mis juhtuks ilma mapideta (testitud filterNormalization.test.ts järgi):
  //  - Otsingu õigsus: ikka õige — serveri buildGenreFilter("Jutlus") on juba
  //    bilinguaalne OR (genre_et="Jutlus" OR genre_en="Jutlus") (vt filterUtils.ts).
  //  - URL-i normaliseerimine: ikka Q-koodiks — Dashboard write-back genreLabelToId.
  //  - Aktiivfiltri pilli KUVAMINE + facet-listi highlight: väike kosmeetiline
  //    tagasilangus. Praegu töötab highlight crossLangMap-i KAUDU: effectiveSelected*
  //    käivitab self-heal efekti (allpool), mis kirjutab selectedValue ümber praeguse
  //    keele labeliks, ja ALLES SIIS leiab resolveItemValue → labelToId → Q-koodi.
  //    Ilma mapideta jääks self-heal käivitamata → resolveItemValue tagastaks võõr-
  //    labeli korral null (facet-pill ilma highlightita) ja aktiivfiltri pill näitaks
  //    teise keele labelit (nt "Jutlus" inglise UI-s) kuni kasutaja filtrit muudab.
  //    Mõlemad on kosmeetilised; otsingu õigsust ei mõjuta (bilinguaalne OR ülal).
  //
  // Järeldus: mapid ei tee pahavara (testidega kaetud) ja mõjutavad ainult ühte
  // väikest kosmeetilist detaili ühes äärejuhtumis. Eemaldamise vaev + väike
  // regressioon ei kaalu üles. Jätame alles. Kui kõik vanad labelipõhised URL-id
  // kunagi kaovad, saab uuesti hinnata.

  // Keelteülene tõlketabel: teise keele väärtus → praeguse keele väärtus
  const crossLangGenreMap = useMemo(() => {
    const map: Record<string, string> = {};
    if (vocabularies?.genres) {
      const altLang = lang === 'et' ? 'en' : 'et';
      for (const [, labels] of Object.entries(vocabularies.genres)) {
        const altLabel = labels[altLang];
        const curLabel = labels[lang] || labels['et'];
        if (altLabel && curLabel && altLabel !== curLabel) map[altLabel] = curLabel;
      }
    }
    return map;
  }, [lang, vocabularies]);

  const crossLangTypeMap = useMemo(() => {
    const map: Record<string, string> = {};
    if (vocabularies?.types) {
      const altLang = lang === 'et' ? 'en' : 'et';
      for (const [, labels] of Object.entries(vocabularies.types)) {
        const altLabel = labels[altLang];
        const curLabel = labels[lang] || labels['et'];
        if (altLabel && curLabel && altLabel !== curLabel) map[altLabel] = curLabel;
      }
    }
    return map;
  }, [lang, vocabularies]);

  // Ettevalmistatud andmed FilterSection jaoks
  const genreItems = useMemo<FilterItem[]>(() => {
    const genreData = facets?.['genre_ids'];
    if (!genreData) return [];

    const raw = Object.entries(genreData)
      .map(([value, count]) => ({
        value,
        count,
        label: genreIdMap?.[value] || value
      }));
    return mergeFacetItems(raw, genreLabelToId, genreIdMap)
      .sort((a, b) => b.count - a.count);
  }, [facets, genreLabelToId, genreIdMap]);

  const tagItems = useMemo<FilterItem[]>(() => {
    const tagsData = facets?.['tags_ids'];
    if (!tagsData) return [];

    const raw = Object.entries(tagsData)
      .filter(([tag]) => !isVuttId(tag))
      .map(([tag, count]) => ({
        value: tag,
        label: tagsIdMap?.[tag] || tag,
        count
      }));
    // tagsLabelToId: label→Q-kood (grupeering), tagsIdMap: Q-kood→praeguse keele label (kuvamine)
    return mergeFacetItems(raw, tagsLabelToId, tagsIdMap)
      .sort((a, b) => b.count - a.count);
  }, [facets, tagsIdMap, tagsLabelToId]);

  const typeItems = useMemo<FilterItem[]>(() => {
    const typeData = facets?.['type_ids'];
    if (!typeData) return [];

    const raw = Object.entries(typeData)
      .map(([value, count]) => ({
        value,
        count,
        label: typeIdMap?.[value] || value
      }));
    return mergeFacetItems(raw, typeLabelToId, typeIdMap)
      .sort((a, b) => b.count - a.count);
  }, [facets, typeLabelToId, typeIdMap]);

  // Efektiivne valitud väärtus: tõlgi kohe sünkroonselt, et nupp oleks sinine ka enne useEffect'i
  const effectiveSelectedGenre = useMemo(
    () => resolveFilterValue(selectedGenre, genreItems, genreIdMap, crossLangGenreMap),
    [selectedGenre, genreItems, genreIdMap, crossLangGenreMap]
  );

  // item.value formaadis (Q-kood) — FilterSection selectedValues ja onToggle jaoks
  const selectedGenreItemValue = useMemo(
    () => resolveItemValue(selectedGenre, genreItems, genreLabelToId),
    [selectedGenre, genreItems, genreLabelToId]
  );

  const effectiveSelectedType = useMemo(
    () => resolveFilterValue(selectedType, typeItems, typeIdMap, crossLangTypeMap),
    [selectedType, typeItems, typeIdMap, crossLangTypeMap]
  );

  const selectedTypeItemValue = useMemo(
    () => resolveItemValue(selectedType, typeItems, typeLabelToId),
    [selectedType, typeItems, typeLabelToId]
  );

  // Efektiivsed valitud märksõnad: lahenda Q-koodid labeliteks
  const effectiveSelectedTags = useMemo(() => {
    if (selectedTags.length === 0 || !tagsIdMap) return selectedTags;
    const tagValues = new Set(tagItems.map(item => item.value));
    let changed = false;
    const resolved = selectedTags.map(tag => {
      if (tagValues.has(tag)) return tag;
      const mapped = tagsIdMap[tag];
      if (mapped && mapped !== tag) { changed = true; return mapped; }
      return tag;
    });
    return changed ? resolved : selectedTags;
  }, [selectedTags, tagItems, tagsIdMap]);

  // Tõlgi valitud žanr/tüüp/märksõnad praegusesse keelde (uuendab ka URL-i ja parent state'i)
  useEffect(() => {
    if (effectiveSelectedGenre && effectiveSelectedGenre !== selectedGenre) {
      onGenreChange(effectiveSelectedGenre);
    }
  }, [effectiveSelectedGenre, selectedGenre]);

  useEffect(() => {
    if (effectiveSelectedType && effectiveSelectedType !== selectedType) {
      onTypeChange(effectiveSelectedType);
    }
  }, [effectiveSelectedType, selectedType]);

  useEffect(() => {
    if (effectiveSelectedTags !== selectedTags) {
      onTagsChange(effectiveSelectedTags);
    }
  }, [effectiveSelectedTags, selectedTags]);

  // Kontrolli, kas on aktiivne filter
  const hasActiveFilters = selectedGenre || selectedTags.length > 0 || selectedType || selectedStatus;

  // Automaatselt laienda kui on aktiivne filter
  useEffect(() => {
    if (hasActiveFilters && !isExpanded) {
      setIsExpanded(true);
    }
  }, [hasActiveFilters]);

  const toggleTag = (tag: string) => {
    if (effectiveSelectedTags.includes(tag)) {
      onTagsChange(effectiveSelectedTags.filter(t => t !== tag));
    } else {
      onTagsChange([...effectiveSelectedTags, tag]);
    }
  };

  return (
    <div className="bg-white/50 rounded-lg border border-gray-200">
      {/* Päis - klapitav */}
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full flex items-center justify-between px-4 py-2 text-left hover:bg-gray-50 transition-colors rounded-lg"
      >
        <span className="flex items-center gap-2 text-sm font-semibold text-gray-700">
          {isExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
          {t('filters.advanced', 'Täpsemad valikud')}
          {hasActiveFilters && (
            <span className="bg-primary-100 text-primary-700 text-xs px-2 py-0.5 rounded-full">
              {[selectedGenre, selectedType, ...selectedTags].filter(Boolean).length}
            </span>
          )}
        </span>
      </button>

      {/* Sisu */}
      {isExpanded && (
        <div className="px-4 pb-4 space-y-3">
          {loading ? (
            <div className="text-sm text-gray-400 py-2">{t('common:labels.loading')}</div>
          ) : (
            <>
              {/* Staatus - jääb eraldi, kuna on väike ja staatiline */}
              <div>
                <h4 className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-2 flex items-center gap-1.5">
                  <CircleDot size={14} className="text-primary-600" />
                  {t('filters.status', 'Staatus')}
                </h4>
                <div className="flex flex-wrap gap-2">
                  {statusOptions.map((status) => {
                    const isSelected = selectedStatus === status;
                    const colorClasses = status === 'Valmis'
                      ? 'bg-green-100 text-green-700 hover:bg-green-200'
                      : status === 'Töös'
                        ? 'bg-amber-100 text-amber-700 hover:bg-amber-200'
                        : 'bg-gray-100 text-gray-700 hover:bg-gray-200';
                    return (
                      <button
                        key={status}
                        onClick={() => onStatusChange(isSelected ? null : status)}
                        className={`px-3 py-1 rounded-full text-sm font-medium transition-colors ${
                          isSelected
                            ? 'bg-primary-600 text-white'
                            : colorClasses
                        }`}
                      >
                        {t(`common:status.${status}`)}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Žanr (genre) */}
              {genreItems.length > 0 && (
                <FilterSection
                  title={t('filters.genre', 'Žanr')}
                  icon={<Bookmark size={12} />}
                  items={genreItems}
                  selectedValues={selectedGenreItemValue ? [selectedGenreItemValue] : []}
                  onToggle={(val) => onGenreChange(selectedGenreItemValue === val ? null : val)}
                  searchPlaceholder={t('filters.searchGenre', 'Otsi žanrit...')}
                />
              )}

              {/* Märksõnad (tags) */}
              {tagItems.length > 0 && (
                <FilterSection
                  title={t('filters.tags', 'Märksõnad')}
                  icon={<Tag size={12} />}
                  items={tagItems}
                  selectedValues={effectiveSelectedTags}
                  onToggle={toggleTag}
                  searchPlaceholder={t('filters.searchTag', 'Otsi märksõna...')}
                  getUnselectedClass={(value) =>
                    value.startsWith('vutt:')
                      ? 'bg-sky-50 text-sky-600 hover:bg-sky-100 border border-sky-200'
                      : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                  }
                />
              )}

              {/* Tüüp (type) */}
              {typeItems.length > 0 && (
                <FilterSection
                  title={t('filters.type', 'Tüüp')}
                  icon={<FileType size={12} />}
                  items={typeItems}
                  selectedValues={selectedTypeItemValue ? [selectedTypeItemValue] : []}
                  onToggle={(val) => onTypeChange(selectedTypeItemValue === val ? null : val)}
                  searchPlaceholder={t('filters.searchType', 'Otsi tüüpi...')}
                />
              )}

              {/* Aktiivsed filtrid + tühjenda */}
              {hasActiveFilters && (
                <div className="pt-2 border-t border-gray-100 space-y-2">
                  <div className="flex flex-wrap gap-1.5">
                    {selectedStatus && (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-amber-50 text-amber-700 border border-amber-200">
                        <CircleDot size={11} />
                        {t(`common:status.${selectedStatus}`)}
                        <button onClick={() => onStatusChange(null)} className="hover:bg-amber-100 rounded-full p-0.5"><X size={11} /></button>
                      </span>
                    )}
                    {effectiveSelectedGenre && (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-violet-50 text-violet-700 border border-violet-200">
                        <Bookmark size={11} />
                        {genreIdMap?.[effectiveSelectedGenre] || effectiveSelectedGenre}
                        <button onClick={() => onGenreChange(null)} className="hover:bg-violet-100 rounded-full p-0.5"><X size={11} /></button>
                      </span>
                    )}
                    {effectiveSelectedTags.map(tag => {
                      // Lahenda Q-kood labeliks: tagsIdMap > enrichedLabels > fallback
                      const tagLabel = tagsIdMap?.[tag] || enrichedLabels?.[tag]?.[lang] || tag;
                      const cap = (s: string) => s ? s[0].toUpperCase() + s.slice(1) : '';
                      return (
                        <span key={tag} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-emerald-50 text-emerald-700 border border-emerald-200">
                          <Tag size={11} />
                          {cap(tagLabel)}
                          <button onClick={() => toggleTag(tag)} className="hover:bg-emerald-100 rounded-full p-0.5"><X size={11} /></button>
                        </span>
                      );
                    })}
                    {effectiveSelectedType && (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-sky-50 text-sky-700 border border-sky-200">
                        <FileType size={11} />
                        {typeIdMap?.[effectiveSelectedType] || effectiveSelectedType}
                        <button onClick={() => onTypeChange(null)} className="hover:bg-sky-100 rounded-full p-0.5"><X size={11} /></button>
                      </span>
                    )}
                  </div>
                  <button
                    onClick={() => {
                      onGenreChange(null);
                      onTagsChange([]);
                      onTypeChange(null);
                      onStatusChange(null);
                    }}
                    className="text-xs text-red-600 hover:text-red-700 font-medium flex items-center gap-1"
                  >
                    {t('filters.clearAdvanced', 'Tühjenda kõik filtrid')}
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
};

export default AdvancedFilters;
