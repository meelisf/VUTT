import React, { useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Search } from 'lucide-react';

type FilterListItem = { value: string; label: string; count: number };

interface SearchableFilterListProps {
    items: FilterListItem[];
    selectedValues: string[];
    onToggle: (value: string) => void;
    placeholder: string;
    isRadio?: boolean;
    renderItem?: (item: FilterListItem, isSelected: boolean) => React.ReactNode;
    /**
     * Esilehe külgriba (#587): näita ainult N esimest (sagedasemat) ja ülejäänud
     * „Näita kõiki" alt. Otsingukast on siis alati nähtav, kui loendis on üle N rea.
     * Valitud rida on alati nähtav, ka siis, kui ta jääb N-st välja.
     */
    collapsedCount?: number;
}

// Abikomponent otsitava ja keritava filtri loendi jaoks.
// Näitab otsinguvälja kui itemeid on üle 10 (või üle `collapsedCount`).
const SearchableFilterList: React.FC<SearchableFilterListProps> = ({
    items, selectedValues, onToggle, placeholder, isRadio = false, renderItem, collapsedCount
}) => {
    const { t } = useTranslation('common');
    const [searchQuery, setSearchQuery] = useState('');
    const [showAll, setShowAll] = useState(false);
    const collapsible = collapsedCount !== undefined && items.length > collapsedCount;
    const showSearch = collapsible || items.length > 10;

    const filteredItems = useMemo(() => {
        if (searchQuery) {
            const lowerQuery = searchQuery.toLowerCase();
            return items.filter(item => item.label.toLowerCase().includes(lowerQuery));
        }
        if (!collapsible || showAll) return items;
        return items.filter((item, i) => i < collapsedCount! || selectedValues.includes(item.value));
    }, [items, searchQuery, collapsible, showAll, collapsedCount, selectedValues]);

    // Kokkupandav loend kerib alles lahti klapituna; vana käitumine (> 10 → kerib) jääb
    const scrollBox = collapsible ? (showAll || !!searchQuery) && filteredItems.length > 10 : showSearch;

    return (
        <div className="space-y-2">
            {showSearch && (
                <div className="relative mb-2">
                    <Search className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-400" size={14} />
                    <input
                        type="text"
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        placeholder={placeholder}
                        className="w-full pl-8 pr-2 py-1.5 text-xs border border-gray-200 rounded focus:outline-none focus:ring-1 focus:ring-primary-500 bg-gray-50/50"
                    />
                </div>
            )}
            <div className={`space-y-1 custom-scrollbar pr-1 ${scrollBox ? 'h-60 overflow-y-scroll' : ''}`}>
                {filteredItems.length === 0 ? (
                    <div className="text-xs text-gray-400 italic py-2 px-1">{t('labels.noMatches')}</div>
                ) : (
                    filteredItems.map((item) => {
                        const isSelected = selectedValues.includes(item.value);
                        if (renderItem) return renderItem(item, isSelected);
                        return (
                            <label key={item.value} className="flex items-center gap-2 cursor-pointer hover:bg-gray-50 p-1 rounded group">
                                <input
                                    type={isRadio ? 'radio' : 'checkbox'}
                                    checked={isSelected}
                                    onChange={() => onToggle(item.value)}
                                    className="text-primary-600 focus:ring-primary-500 rounded"
                                />
                                <span className={`text-sm flex-1 truncate ${isSelected ? 'text-primary-700 font-medium' : 'text-gray-700'}`}>
                                    {item.label}
                                </span>
                                <span className="text-xs text-gray-400 group-hover:text-gray-600">({item.count})</span>
                            </label>
                        );
                    })
                )}
            </div>
            {collapsible && !searchQuery && (
                <button
                    type="button"
                    onClick={() => setShowAll(v => !v)}
                    className="text-xs text-primary-600 hover:underline px-1"
                >
                    {showAll ? t('labels.showLess') : t('labels.showAllCount', { count: items.length })}
                </button>
            )}
        </div>
    );
};

export default SearchableFilterList;
