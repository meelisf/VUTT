/**
 * Sihtkoha valija: millisesse töökollektsiooni teosed lisada (#354, spekk §1.3).
 *
 * Loendis on ainult kogud, kuhu see kutsuja TOHIB lisada (`manageableWorkSets`):
 * vaataja ei saa lisada ja arhiveeritud kogu ei võta uusi liikmeid.
 */
import React, { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Users, X, Loader2, Search } from 'lucide-react';
import { useCollection } from '../contexts/CollectionContext';
import { manageableWorkSets } from './pickerEntries';
import { getLangCode } from '../utils/getLangCode';

interface WorkSetPickerProps {
  isOpen: boolean;
  onClose: () => void;
  /** Kutsutakse valitud kogu id-ga. Kutsuja vastutab salvestamise ja vigade eest. */
  onSelect: (setId: string) => void;
  /** Kui antud, kuvatakse nupul mitme teose kohta valik käib. */
  selectedCount?: number;
  busy?: boolean;
}

const WorkSetPicker: React.FC<WorkSetPickerProps> = ({
  isOpen, onClose, onSelect, selectedCount, busy = false,
}) => {
  const { t, i18n } = useTranslation(['common']);
  const { workSets } = useCollection();
  const lang = getLangCode(i18n.language);
  const [query, setQuery] = useState('');

  const kogud = useMemo(
    () => manageableWorkSets(workSets, query, lang),
    [workSets, query, lang],
  );

  if (!isOpen) return null;

  return (
    // Päis on `sticky z-[1200]` — täisekraani-modaal peab olema kõrgemal.
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[1300]">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-md mx-4 overflow-hidden max-h-[80vh] flex flex-col">
        <div className="bg-primary-600 px-6 py-4 flex items-center justify-between">
          <h2 className="text-lg font-bold text-white flex items-center gap-2">
            <Users size={20} />
            {t('workSets.selectTarget', 'Vali töökollektsioon')}
          </h2>
          <button onClick={onClose} className="text-white/80 hover:text-white transition-colors">
            <X size={22} />
          </button>
        </div>

        {selectedCount !== undefined && (
          <div className="px-6 pt-3 text-sm text-gray-600">
            {t('workSets.selectedWorks', { count: selectedCount })}
          </div>
        )}

        <div className="px-4 pt-3">
          <div className="relative">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t('workSets.search', 'Otsi kogu nime järgi')}
              className="w-full pl-9 pr-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
            />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          {kogud.length === 0 ? (
            <p className="text-gray-500 text-center py-8 text-sm">
              {query.trim()
                ? t('workSets.noMatches', 'Ükski kogu ei vasta otsingule')
                : t('workSets.noManageable', 'Sa ei halda ühtki aktiivset töökollektsiooni')}
            </p>
          ) : (
            kogud.map(ws => (
              <button
                key={ws.id}
                onClick={() => onSelect(ws.id)}
                disabled={busy}
                className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-left transition-colors hover:bg-gray-100 disabled:opacity-50"
              >
                <Users size={18} className="text-gray-400" />
                <span className="flex-1 truncate">
                  {ws.name[lang] || ws.name.et || ws.name.en || ws.id}
                </span>
                {busy && <Loader2 size={16} className="animate-spin text-gray-400" />}
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
};

export default WorkSetPicker;
