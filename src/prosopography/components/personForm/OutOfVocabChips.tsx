import React from 'react';
import { useTranslation } from 'react-i18next';
import { X } from 'lucide-react';
import type { VocabularySeisusItem } from '../../../services/collectionService';

type Item = { id: string; label: string; labels?: { et?: string; en?: string } };

interface Props {
  ids: string[];
  vocab: VocabularySeisusItem[];
  // Salvestatud kaardi kirjed — sõnastikuvälise väärtuse silt tuleb siit.
  saved: Item[] | undefined;
  onRemove: (id: string) => void;
}

/** Kaardil olevad väärtused, mida suletud sõnastik ei tunne (vana kaart,
 *  varasem Wikidata rikastus). Ilma selleta olid nad vormis nähtamatud ega
 *  eemaldatavad (Kristiina Q9592, 2026-09-25). */
const OutOfVocabChips: React.FC<Props> = ({ ids, vocab, saved, onRemove }) => {
  const { t, i18n } = useTranslation(['prosopography']);
  // Laadimata sõnastiku ajal oleks iga väärtus „väline".
  if (vocab.length === 0) return null;
  const välised = ids.filter(id => !vocab.some(v => v.id === id));
  const en = i18n.language?.startsWith('en');
  return (
    <>
      {välised.map(id => {
        const item = saved?.find(s => s.id === id);
        const label = (en ? item?.labels?.en : item?.labels?.et) || item?.label || id;
        return (
          <span
            key={id}
            title={t('outOfVocab')}
            className="inline-flex items-center gap-1 pl-3 pr-1.5 py-1 rounded-full text-sm font-medium border border-amber-400 bg-amber-50 text-amber-800"
          >
            {label}
            <button
              type="button"
              onClick={() => onRemove(id)}
              aria-label={t('outOfVocabRemove', { label })}
              className="rounded-full p-0.5 hover:bg-amber-200"
            >
              <X size={12} />
            </button>
          </span>
        );
      })}
    </>
  );
};

export default OutOfVocabChips;
