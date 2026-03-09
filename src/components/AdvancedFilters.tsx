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
import { getGenreFacets, getTypeFacets, getTeoseTagsFacets, FacetDistribution } from '../services/searchService';
import { getVocabularies, Vocabularies } from '../services/collectionService';

interface FacetItem {
  value: string;
  count: number;
}

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
  // Kollektsiooni filter - facetid filtreeritakse selle järgi
  collection?: string | null;
  // Aasta vahemik - facetid filtreeritakse selle järgi
  yearStart?: number;
  yearEnd?: number;
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
}

interface FilterItem {
  value: string;
  label: string;
  count: number;
}

interface FilterSectionProps {
  title: string;
  icon: React.ReactNode;
  items: FilterItem[];
  selectedValues: string[];
  onToggle: (value: string) => void;
  searchPlaceholder: string;
}

const FilterSection: React.FC<FilterSectionProps> = ({
  title,
  icon,
  items,
  selectedValues,
  onToggle,
  searchPlaceholder
}) => {
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
            <span className="text-sm text-gray-400 italic py-1">Ei leitud vasteid</span>
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
                      : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
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
  collection,
  yearStart,
  yearEnd,
  defaultExpanded = false,
  facets,
  genreIdMap,
  genreLabelToId,
  tagsIdMap,
  tagsLabelToId,
  typeIdMap,
  typeLabelToId,
  lang: propLang
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

  // Abifunktsioon: ühenda facet-itemid sama Q-koodi all
  // Lahendab Wikidatas muutunud labelid: "Oratsioon" + "Kõne" → Q861911 (üks item)
  const mergeFacetItems = (
    items: FilterItem[],
    labelToId?: Record<string, string>,  // label → Q-kood
    idToLabel?: Record<string, string>   // Q-kood → kuvatav label
  ): FilterItem[] => {
    const merged = new Map<string, FilterItem>();
    for (const item of items) {
      // Proovi lahendada Q-koodiks — üks kood tabab kõiki selle žanri labeli variante
      const qCode = labelToId?.[item.value] || labelToId?.[item.value.charAt(0).toUpperCase() + item.value.slice(1).toLowerCase()];
      // Grupeeri Q-koodi järgi (stabiilne ID), muidu labeli järgi
      const groupKey = qCode || item.value;
      // Kuvatav label: Q-koodi praegune label, muidu originaal
      const displayLabel = (qCode && idToLabel?.[qCode]) || idToLabel?.[item.value] || item.value;
      const existing = merged.get(groupKey);
      if (existing) {
        existing.count += item.count;
      } else {
        // value = Q-kood → filtreerimisel kasutatakse genre_ids, mitte genre_et stringi
        merged.set(groupKey, { value: qCode || item.value, label: displayLabel, count: item.count });
      }
    }
    return Array.from(merged.values());
  };

  // Ettevalmistatud andmed FilterSection jaoks
  const genreItems = useMemo<FilterItem[]>(() => {
    const genreKey = `genre_${lang}` as keyof FacetDistribution;
    const genreData = facets?.[genreKey] as Record<string, number> | undefined;
    if (!genreData) return [];

    const raw = Object.entries(genreData)
      .map(([value, count]) => ({
        value,
        count,
        label: vocabularies?.genres?.[value]?.[lang] || vocabularies?.genres?.[value]?.et || value
      }));
    return mergeFacetItems(raw, genreLabelToId, genreIdMap)
      .sort((a, b) => b.count - a.count);
  }, [facets, lang, vocabularies, genreLabelToId, genreIdMap]);

  const tagItems = useMemo<FilterItem[]>(() => {
    const tagsKey = `tags_${lang}` as keyof FacetDistribution;
    const tagsData = facets?.[tagsKey] as Record<string, number> | undefined;
    if (!tagsData) return [];

    const raw = Object.entries(tagsData)
      .map(([tag, count]) => ({
        value: tag,
        label: tag,
        count
      }));
    // tagsLabelToId: label→Q-kood (grupeering), tagsIdMap: Q-kood→praeguse keele label (kuvamine)
    return mergeFacetItems(raw, tagsLabelToId, tagsIdMap)
      .sort((a, b) => b.count - a.count);
  }, [facets, lang, tagsIdMap, tagsLabelToId]);

  const typeItems = useMemo<FilterItem[]>(() => {
    const typeKey = `type_${lang}` as keyof FacetDistribution;
    const typeData = facets?.[typeKey] as Record<string, number> | undefined;
    if (!typeData) return [];

    const raw = Object.entries(typeData)
      .map(([value, count]) => ({
        value,
        count,
        label: vocabularies?.types?.[value]?.[lang] || vocabularies?.types?.[value]?.et || value
      }));
    return mergeFacetItems(raw, typeLabelToId, typeIdMap)
      .sort((a, b) => b.count - a.count);
  }, [facets, lang, vocabularies, typeLabelToId, typeIdMap]);

  // Efektiivne valitud väärtus: tõlgi kohe sünkroonselt, et nupp oleks sinine ka enne useEffect'i
  const effectiveSelectedGenre = useMemo(() => {
    if (!selectedGenre) return null;
    const found = genreItems.find(item => item.value === selectedGenre);
    if (found) return found.label;
    // Q-kood → label (Wikidata žanrid)
    if (genreIdMap?.[selectedGenre]) return genreIdMap[selectedGenre];
    // Vocabulary-põhine tõlge (vocabularies-is defineeritud žanrid)
    return crossLangGenreMap[selectedGenre] || selectedGenre;
  }, [selectedGenre, genreItems, genreIdMap, crossLangGenreMap]);

  // item.value formaadis (Q-kood) — FilterSection selectedValues ja onToggle jaoks
  const selectedGenreItemValue = useMemo(() => {
    if (!selectedGenre) return null;
    if (genreItems.some(item => item.value === selectedGenre)) return selectedGenre;
    const qcode = genreLabelToId?.[selectedGenre];
    if (qcode && genreItems.some(item => item.value === qcode)) return qcode;
    return null;
  }, [selectedGenre, genreItems, genreLabelToId]);

  const effectiveSelectedType = useMemo(() => {
    if (!selectedType) return null;
    const found = typeItems.find(item => item.value === selectedType);
    if (found) return found.label;
    // Q-kood → label (Wikidata tüübid)
    if (typeIdMap?.[selectedType]) return typeIdMap[selectedType];
    // Vocabulary-põhine fallback
    return crossLangTypeMap[selectedType] || selectedType;
  }, [selectedType, typeItems, typeIdMap, crossLangTypeMap]);

  const selectedTypeItemValue = useMemo(() => {
    if (!selectedType) return null;
    if (typeItems.some(item => item.value === selectedType)) return selectedType;
    const qcode = typeLabelToId?.[selectedType];
    if (qcode && typeItems.some(item => item.value === qcode)) return qcode;
    return null;
  }, [selectedType, typeItems, typeLabelToId]);

  // Efektiivsed valitud märksõnad: lahenda Q-koodid labeliteks
  const effectiveSelectedTags = useMemo(() => {
    if (selectedTags.length === 0 || !tagsIdMap) return selectedTags;
    const tagValues = new Set(tagItems.map(item => item.value));
    let changed = false;
    const resolved = selectedTags.map(tag => {
      if (tagValues.has(tag)) return tag;
      if (tagsIdMap[tag]) { changed = true; return tagsIdMap[tag]; }
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
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-primary-100 text-primary-700">
                        {t(`common:status.${selectedStatus}`)}
                        <button onClick={() => onStatusChange(null)} className="hover:text-primary-900"><X size={12} /></button>
                      </span>
                    )}
                    {effectiveSelectedGenre && (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-primary-100 text-primary-700">
                        {effectiveSelectedGenre}
                        <button onClick={() => onGenreChange(null)} className="hover:text-primary-900"><X size={12} /></button>
                      </span>
                    )}
                    {effectiveSelectedTags.map(tag => (
                      <span key={tag} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-primary-100 text-primary-700">
                        {tagsIdMap?.[tag] || tag}
                        <button onClick={() => toggleTag(tag)} className="hover:text-primary-900"><X size={12} /></button>
                      </span>
                    ))}
                    {effectiveSelectedType && (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-primary-100 text-primary-700">
                        {effectiveSelectedType}
                        <button onClick={() => onTypeChange(null)} className="hover:text-primary-900"><X size={12} /></button>
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
