/**
 * Kollektsioonivormide jagatud juhtelemendid.
 *
 * Neid kasutavad NII `CollectionEditor` (olemasoleva kogu muutmine) kui
 * `CollectionCreateForm` (uue loomine). Loomisvorm tõsteti editorist välja,
 * sest kogu loomine ei ole ühe kogu operatsioon ega kuulu tema detaillehele
 * (#318) — jagatud osa peab siis elama mõlemast sõltumatus moodulis.
 */
import React from 'react';
import { CollectionTreeNode } from '../services/collectionService';

// Tailwind 400-taseme värvid värviplaatide jaoks (inline style — ei sõltu Tailwind JIT kompileerimisest)
export const COLOR_SWATCHES: Record<string, string> = {
  red: '#f87171', orange: '#fb923c', amber: '#fbbf24', yellow: '#facc15',
  lime: '#a3e635', green: '#4ade80', emerald: '#34d399', teal: '#2dd4bf',
  cyan: '#22d3ee', sky: '#38bdf8', blue: '#60a5fa', indigo: '#818cf8',
  violet: '#a78bfa', purple: '#c084fc', fuchsia: '#e879f9', pink: '#f472b6',
  rose: '#fb7185',
};

// Visuaalne värvivalija — ruudustik värviliste plaatidega
export const ColorPicker: React.FC<{ value: string; onChange: (c: string) => void }> = ({ value, onChange }) => (
  <div className="flex flex-wrap gap-1.5">
    {Object.entries(COLOR_SWATCHES).map(([name, hex]) => (
      <button
        key={name}
        type="button"
        title={name}
        onClick={() => onChange(name)}
        style={{ backgroundColor: hex }}
        className={`w-6 h-6 rounded-full transition-all focus:outline-none ${
          value === name
            ? 'ring-2 ring-offset-1 ring-gray-600 scale-110'
            : 'hover:scale-110 hover:ring-1 hover:ring-offset-1 hover:ring-gray-400'
        }`}
      />
    ))}
  </div>
);

// Ehitab hierarhilise <option> massiivi puust (rekursiivne)
export function renderTreeOptions(nodes: CollectionTreeNode[], depth = 0): React.ReactNode[] {
  const prefix = depth > 0 ? '    '.repeat(depth) + '↳ ' : '';
  return nodes.flatMap(node => [
    <option key={node.id} value={node.id}>
      {prefix}{node.collection.name.et}
      {node.collection.type === 'virtual_group' ? ' (grupp)' : ''}
    </option>,
    ...renderTreeOptions(node.children, depth + 1),
  ]);
}
