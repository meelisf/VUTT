import React, { useState } from 'react';
import { Library, ChevronDown } from 'lucide-react';
import CollectionPicker from './CollectionPicker';
import { useSelectionLabel } from '../hooks/useSelectionLabel';

/**
 * Aktiivse valiku (kogu / töökollektsioon) nupp kitsal ekraanil, kus päise
 * valija on peidus (`sm`-st kitsam). Ainult kogu järgi piiratud lehtedel
 * (Dashboard, otsing) — valik jääb lehele, navigeerimist ei toimu.
 */
const MobileSelectionButton: React.FC<{ className?: string }> = ({ className = '' }) => {
  const { label, colorClasses } = useSelectionLabel();
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        className={`sm:hidden flex items-center gap-2 w-full px-3 py-2 rounded-lg border text-sm font-medium transition-colors ${
          colorClasses
            ? `${colorClasses.bg} ${colorClasses.border} ${colorClasses.text} ${colorClasses.hoverBg}`
            : 'bg-white border-gray-200 text-gray-700 hover:bg-gray-100'
        } ${className}`}
        onClick={() => setOpen(true)}
      >
        <Library size={16} className={colorClasses ? colorClasses.text : 'text-primary-600'} />
        <span className="flex-1 text-left truncate">{label}</span>
        <ChevronDown size={14} className="shrink-0 opacity-50" />
      </button>
      <CollectionPicker isOpen={open} onClose={() => setOpen(false)} />
    </>
  );
};

export default MobileSelectionButton;
