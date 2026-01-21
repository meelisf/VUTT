/**
 * AdvancedFilters - Täpsemad filtrid Dashboard ja SearchPage jaoks
 *
 * Allaklapitav paneel, mis sisaldab:
 * - Staatuse filter (teose_staatus)
 * - Žanri filter (genre)
 * - Märksõnade filter (tags/teose_tags)
 * - Tüübi filter (type)
 */
import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronDown, ChevronRight, Tag, BookOpen, FileType, CircleDot } from 'lucide-react';
import { getGenreFacets, getTypeFacets, getTeoseTagsFacets } from '../services/meiliService';
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
  // Valikuline: kas panna alguses lahti
  defaultExpanded?: boolean;
}

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
  defaultExpanded = false
}) => {
  const { t, i18n } = useTranslation(['dashboard', 'common']);
  const lang = (i18n.language as 'et' | 'en') || 'et';
  const [isExpanded, setIsExpanded] = useState(defaultExpanded);

  // Facetide ja sõnavara state
  const [genres, setGenres] = useState<FacetItem[]>([]);
  const [tags, setTags] = useState<{ tag: string; count: number }[]>([]);
  const [types, setTypes] = useState<FacetItem[]>([]);
  const [vocabularies, setVocabularies] = useState<Vocabularies | null>(null);
  const [loading, setLoading] = useState(true);

  // Staatuse valikud (fikseeritud, mitte facet)
  const statusOptions: WorkStatus[] = ['Toores', 'Töös', 'Valmis'];

  // Lae facetid ja sõnavara - uuesti kui kollektsioon muutub
  useEffect(() => {
    const loadFacets = async () => {
      setLoading(true);
      try {
        const collectionFilter = collection || undefined;
        const [genreData, tagData, typeData, vocabs] = await Promise.all([
          getGenreFacets(collectionFilter),
          getTeoseTagsFacets(collectionFilter),
          getTypeFacets(collectionFilter),
          getVocabularies()
        ]);
        setGenres(genreData);
        setTags(tagData);
        setTypes(typeData);
        setVocabularies(vocabs);
      } catch (e) {
        console.warn('Facetide laadimine ebaõnnestus:', e);
      } finally {
        setLoading(false);
      }
    };
    loadFacets();
  }, [collection]);

  // Kontrolli, kas on aktiivne filter
  const hasActiveFilters = selectedGenre || selectedTags.length > 0 || selectedType || selectedStatus;

  // Automaatselt laienda kui on aktiivne filter
  useEffect(() => {
    if (hasActiveFilters && !isExpanded) {
      setIsExpanded(true);
    }
  }, [hasActiveFilters]);

  const toggleTag = (tag: string) => {
    if (selectedTags.includes(tag)) {
      onTagsChange(selectedTags.filter(t => t !== tag));
    } else {
      onTagsChange([...selectedTags, tag]);
    }
  };

  return (
    <div className="bg-white/50 rounded-lg border border-gray-200">
      {/* Päis - klapitav */}
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-gray-50 transition-colors rounded-lg"
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
        <div className="px-4 pb-4 space-y-4">
          {loading ? (
            <div className="text-sm text-gray-400 py-2">{t('common:labels.loading')}</div>
          ) : (
            <>
              {/* Staatus */}
              <div>
                <h4 className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-2 flex items-center gap-1.5">
                  <CircleDot size={12} />
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
              {genres.length > 0 && (
                <div>
                  <h4 className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-2 flex items-center gap-1.5">
                    <BookOpen size={12} />
                    {t('filters.genre', 'Žanr')}
                  </h4>
                  <div className="flex flex-wrap gap-2">
                    {genres.map(({ value, count }) => {
                      const isSelected = selectedGenre === value;
                      const label = vocabularies?.genres?.[value]?.[lang] || vocabularies?.genres?.[value]?.et || value;
                      return (
                        <button
                          key={value}
                          onClick={() => onGenreChange(isSelected ? null : value)}
                          className={`px-3 py-1 rounded-full text-sm font-medium transition-colors ${
                            isSelected
                              ? 'bg-primary-600 text-white'
                              : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                          }`}
                        >
                          {label} <span className="opacity-60">({count})</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Märksõnad (tags) */}
              {tags.length > 0 && (
                <div>
                  <h4 className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-2 flex items-center gap-1.5">
                    <Tag size={12} />
                    {t('filters.tags', 'Märksõnad')}
                  </h4>
                  <div className="flex flex-wrap gap-2">
                    {tags.map(({ tag, count }) => {
                      const isSelected = selectedTags.includes(tag);
                      return (
                        <button
                          key={tag}
                          onClick={() => toggleTag(tag)}
                          className={`px-3 py-1 rounded-full text-sm font-medium transition-colors ${
                            isSelected
                              ? 'bg-primary-600 text-white'
                              : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                          }`}
                        >
                          {tag} <span className="opacity-60">({count})</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Tüüp (type) */}
              {types.length > 0 && (
                <div>
                  <h4 className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-2 flex items-center gap-1.5">
                    <FileType size={12} />
                    {t('filters.type', 'Tüüp')}
                  </h4>
                  <div className="flex flex-wrap gap-2">
                    {types.map(({ value, count }) => {
                      const isSelected = selectedType === value;
                      const label = vocabularies?.types?.[value]?.[lang] || vocabularies?.types?.[value]?.et || value;
                      return (
                        <button
                          key={value}
                          onClick={() => onTypeChange(isSelected ? null : value)}
                          className={`px-3 py-1 rounded-full text-sm font-medium transition-colors ${
                            isSelected
                              ? 'bg-primary-600 text-white'
                              : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                          }`}
                        >
                          {label} <span className="opacity-60">({count})</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Tühjenda filtrid */}
              {hasActiveFilters && (
                <button
                  onClick={() => {
                    onGenreChange(null);
                    onTagsChange([]);
                    onTypeChange(null);
                    onStatusChange(null);
                  }}
                  className="text-sm text-red-600 hover:text-red-700 font-medium"
                >
                  {t('filters.clearAdvanced', 'Tühjenda täpsemad filtrid')}
                </button>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
};

export default AdvancedFilters;
