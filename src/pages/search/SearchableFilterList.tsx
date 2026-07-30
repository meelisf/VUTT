import React, { useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Search } from 'lucide-react';

interface SearchableFilterListProps {
    items: { value: string; label: string; count: number }[];
    selectedValues: string[];
    onToggle: (value: string) => void;
    placeholder: string;
    isRadio?: boolean;
    renderItem?: (item: { value: string; label: string; count: number }, isSelected: boolean) => React.ReactNode;
}

// Abikomponent otsitava ja keritava filtri loendi jaoks.
// Näitab otsinguvälja kui itemeid on üle 10.
const SearchableFilterList: React.FC<SearchableFilterListProps> = ({
    items, selectedValues, onToggle, placeholder, isRadio = false, renderItem
}) => {
    const { t } = useTranslation('common');
    const [searchQuery, setSearchQuery] = useState('');
    const showSearch = items.length > 10;

    const filteredItems = useMemo(() => {
        if (!searchQuery) return items;
        const lowerQuery = searchQuery.toLowerCase();
        return items.filter(item => item.label.toLowerCase().includes(lowerQuery));
    }, [items, searchQuery]);

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
            <div className={`space-y-1 overflow-y-scroll custom-scrollbar pr-1 ${showSearch ? 'h-60' : ''}`}>
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
        </div>
    );
};

export default SearchableFilterList;
