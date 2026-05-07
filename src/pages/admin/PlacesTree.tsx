import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronDown, ChevronRight, AlertTriangle } from 'lucide-react';
import type { PlaceTreeGroup, PlaceTreeNode } from './placesTreeUtils';

interface PlacesTreeProps {
  groups: PlaceTreeGroup[];
  selectedKey: string | null;
  onSelect: (key: string) => void;
  lang: string;
}

function resolveLabel(labels: Record<string, string> | null | undefined, lang: string): string {
  if (!labels) return '';
  return labels[lang] ?? labels.et ?? labels.en ?? Object.values(labels)[0] ?? '';
}

function TreeNode({
  node, depth, selectedKey, onSelect, lang,
}: {
  node: PlaceTreeNode;
  depth: number;
  selectedKey: string | null;
  onSelect: (key: string) => void;
  lang: string;
}) {
  const [open, setOpen] = useState(depth < 2);
  const hasChildren = node.children.length > 0;
  const isSelected = node.key === selectedKey;
  const hasQCode = !!node.entry.id;

  return (
    <div>
      <button
        type="button"
        onClick={() => { onSelect(node.key); if (hasChildren) setOpen(o => !o); }}
        style={{ paddingLeft: `${8 + depth * 16}px` }}
        className={`w-full text-left flex items-center gap-1 py-1 pr-2 rounded text-sm
          ${isSelected ? 'bg-primary-50 text-primary-700 font-medium' : 'text-gray-700 hover:bg-gray-50'}`}
      >
        <span className="shrink-0 w-4 text-gray-400">
          {hasChildren
            ? (open ? <ChevronDown size={13} /> : <ChevronRight size={13} />)
            : <span className="inline-block w-3" />}
        </span>
        <span className="truncate flex-1">
          {resolveLabel(node.entry.labels, lang) || node.key}
          {!Object.values(node.entry.labels ?? {}).includes(node.key) && (
            <span className="text-xs text-gray-400 ml-1 font-normal">{node.key}</span>
          )}
        </span>
        {node.entry.type && (
          <span className="text-xs text-gray-400 shrink-0">{node.entry.type}</span>
        )}
        {!hasQCode && (
          <AlertTriangle size={11} className="text-amber-400 shrink-0" title="Q-kood puudub" />
        )}
      </button>
      {hasChildren && open && (
        <div>
          {node.children.map(child => (
            <TreeNode
              key={child.key}
              node={child}
              depth={depth + 1}
              selectedKey={selectedKey}
              onSelect={onSelect}
              lang={lang}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function SubGroupSection({ group, selectedKey, onSelect, lang }: {
  group: PlaceTreeGroup;
  selectedKey: string | null;
  onSelect: (key: string) => void;
  lang: string;
}) {
  const [open, setOpen] = useState(true);
  const label = group.groupLabels
    ? resolveLabel(group.groupLabels, lang)
    : (group.groupKey ?? '—');

  return (
    <div className="mt-1">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="w-full text-left flex items-center gap-1 px-3 py-0.5"
      >
        <span className="text-gray-400">
          {open ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
        </span>
        <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider truncate">
          {label}
        </span>
      </button>
      {open && group.nodes.map(node => (
        <TreeNode key={node.key} node={node} depth={1} selectedKey={selectedKey} onSelect={onSelect} lang={lang} />
      ))}
    </div>
  );
}

const PlacesTree: React.FC<PlacesTreeProps> = ({ groups, selectedKey, onSelect, lang }) => {
  const { t } = useTranslation('admin');

  if (groups.length === 0) {
    return <p className="px-3 py-4 text-sm text-gray-400 italic">Kohti pole</p>;
  }

  return (
    <div className="py-2">
      {groups.map(group => (
        <div key={group.groupKey ?? '__ungrouped'} className="mb-3">
          <div className="px-3 pb-1 text-sm font-semibold text-gray-700">
            {group.groupLabels ? resolveLabel(group.groupLabels, lang) : t('places.ungrouped')}
          </div>
          {group.nodes.map(node => (
            <TreeNode key={node.key} node={node} depth={0} selectedKey={selectedKey} onSelect={onSelect} lang={lang} />
          ))}
          {group.subGroups.map(sub => (
            <SubGroupSection key={sub.groupKey} group={sub} selectedKey={selectedKey} onSelect={onSelect} lang={lang} />
          ))}
        </div>
      ))}
    </div>
  );
};

export default PlacesTree;
