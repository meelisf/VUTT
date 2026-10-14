import type { LucideIcon } from 'lucide-react';

export interface ResultsViewOption<V extends string> {
  value: V;
  icon: LucideIcon;
  label: string;
}

/**
 * Tulemuste vaate lüliti (#587): teoste leht (ruudustik · loend) ja isikute
 * leht (ruudustik · loend · kaart) kasutavad sama nupurühma.
 */
function ResultsViewToggle<V extends string>({ value, options, onChange, groupLabel }: {
  value: V;
  options: ResultsViewOption<V>[];
  onChange: (value: V) => void;
  groupLabel: string;
}) {
  return (
    <div className="flex border border-gray-300 rounded overflow-hidden bg-white shrink-0" role="group" aria-label={groupLabel}>
      {options.map(({ value: v, icon: Icon, label }, i) => (
        <button
          key={v}
          type="button"
          onClick={() => onChange(v)}
          aria-pressed={value === v}
          title={label}
          aria-label={label}
          className={`p-1.5 ${i > 0 ? 'border-l border-gray-300' : ''} ${
            value === v ? 'bg-gray-100 text-gray-900' : 'text-gray-400 hover:text-gray-700'
          }`}
        >
          <Icon size={16} />
        </button>
      ))}
    </div>
  );
}

export default ResultsViewToggle;
