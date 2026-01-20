import React, { useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Library, ChevronRight, ChevronDown, X, Check, FolderOpen } from 'lucide-react';
import { useCollection } from '../contexts/CollectionContext';
import { Collection, buildCollectionTree, CollectionTreeNode } from '../services/collectionService';

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
}> = ({ node, level, selectedId, onSelect, lang, expandedIds, toggleExpanded }) => {
  const isExpanded = expandedIds.has(node.id);
  const hasChildren = node.children.length > 0;
  const isSelected = selectedId === node.id;

  return (
    <div>
      <div
        className={`
          w-full flex items-center gap-2 px-3 py-2 rounded-lg text-left transition-colors
          ${isSelected ? 'bg-primary-100 text-primary-800' : 'hover:bg-gray-100'}
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
          <FolderOpen size={18} className={isSelected ? 'text-primary-600' : 'text-gray-400'} />
          <span className="flex-1 truncate text-left">
            {node.collection.name[lang] || node.collection.name.et}
          </span>
          {isSelected && <Check size={18} className="text-primary-600" />}
        </button>
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
  const { selectedCollection, setSelectedCollection, collections } = useCollection();
  const lang = (i18n.language as 'et' | 'en') || 'et';

  // Laiendatud sõlmed
  const [expandedIds, setExpandedIds] = useState<Set<string>>(() => {
    // Vaikimisi laienda kõik tippkollektsioonid
    const initial = new Set<string>();
    Object.entries(collections).forEach(([id, col]) => {
      if (!col.parent) {
        initial.add(id);
      }
    });
    return initial;
  });

  // Ehita puu
  const tree = useMemo(() => buildCollectionTree(collections), [collections]);

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
      setSelectedCollection(id);
    }
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
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

        {/* Sisu */}
        <div className="flex-1 overflow-y-auto p-4">
          {/* "Kõik tööd" valik - ainult headeris */}
          {!onSelect && (
            <>
              <button
                onClick={() => handleSelect(null)}
                className={`
                  w-full flex items-center gap-2 px-3 py-2 rounded-lg text-left transition-colors mb-2
                  ${selectedCollection === null ? 'bg-primary-100 text-primary-800' : 'hover:bg-gray-100'}
                `}
              >
                <span className="w-5" />
                <Library size={18} className={selectedCollection === null ? 'text-primary-600' : 'text-gray-400'} />
                <span className="flex-1">{t('collections.all', 'Kõik tööd')}</span>
                {selectedCollection === null && <Check size={18} className="text-primary-600" />}
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

          {/* Puu */}
          {tree.length === 0 ? (
            <p className="text-gray-500 text-center py-8">
              {t('collections.empty', 'Kollektsioone pole veel lisatud')}
            </p>
          ) : (
            tree.map((node) => (
              <TreeNode
                key={node.id}
                node={node}
                level={0}
                selectedId={selectedCollection}
                onSelect={handleSelect}
                lang={lang}
                expandedIds={expandedIds}
                toggleExpanded={toggleExpanded}
              />
            ))
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
