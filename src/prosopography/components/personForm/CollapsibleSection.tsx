import React from 'react';
import { ChevronDown, ChevronRight, Plus } from 'lucide-react';

export const CollapsibleSection: React.FC<{
  title: string;
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}> = ({ title, open, onToggle, children }) => (
  <div className="bg-white rounded-lg border border-gray-200 shadow-sm mb-5">
    <button
      onClick={onToggle}
      className="w-full flex items-center gap-2 px-5 py-4 text-gray-700 hover:text-primary-700 transition-colors"
    >
      <span className="font-bold text-sm capitalize-first">{title}</span>
      <span className="ml-auto text-gray-400">
        {open ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
      </span>
    </button>
    {open && (
      <div className="px-5 pb-5 border-t border-gray-100 pt-4 space-y-5">
        {children}
      </div>
    )}
  </div>
);

export function DynamicList<T>({
  label, items, renderItem, onAdd, onChange,
}: {
  label: string;
  items: T[];
  renderItem: (item: T, onChange: (v: T) => void, onRemove: () => void) => React.ReactNode;
  onAdd: () => void;
  onChange: (items: T[]) => void;
}): React.ReactElement {
  const updateItem = (i: number, v: T) => {
    const next = [...items];
    next[i] = v;
    onChange(next);
  };
  const removeItem = (i: number) => onChange(items.filter((_, j) => j !== i));

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <label className="block text-xs text-gray-500 uppercase tracking-wide">{label}</label>
        <button
          type="button"
          onClick={onAdd}
          className="flex items-center gap-1 text-xs px-2 py-1 rounded border border-gray-300 text-gray-600 hover:bg-gray-50 transition-colors"
        >
          <Plus size={11} /> Lisa
        </button>
      </div>
      {items.length === 0 && (
        <p className="text-xs text-gray-400 italic">Kirjeid pole. Klõpsa "Lisa" lisamiseks.</p>
      )}
      <div className="space-y-2">
        {items.map((item, i) => (
          <div key={i}>{renderItem(item, v => updateItem(i, v), () => removeItem(i))}</div>
        ))}
      </div>
    </div>
  );
}
