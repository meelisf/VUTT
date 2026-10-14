import React from 'react';
import { useTranslation } from 'react-i18next';
import { Check } from 'lucide-react';
import { useLocation, useNavigate } from 'react-router-dom';
import type { ProsopoIndexEntry } from '../types';
import type { VocabularySeisusItem } from '../../services/collectionService';
import { personImageProps } from '../utils/personImage';
import { Initials, Lifespan, personOrigin, personStatusText, verificationDotClass } from '../utils/personDisplay';

interface PersonListRowProps {
  person: ProsopoIndexEntry;
  selectMode?: boolean;
  selected?: boolean;
  onSelect?: () => void;
  statusVocab?: VocabularySeisusItem[];
}

/**
 * Isik loendivaates (#587), peegeldab teoste `WorkListRow`-d: väike pilt,
 * täisnimi, eluaastad, päritolu ja seisus; paremal kontrollitaseme täpp.
 * Valikurežiimis (liitmine) valib klikk isiku, muidu avab isikulehe.
 */
const PersonListRow: React.FC<PersonListRowProps> = ({ person, selectMode = false, selected = false, onSelect, statusVocab }) => {
  const { t, i18n } = useTranslation(['prosopography']);
  const location = useLocation();
  const navigate = useNavigate();
  const lang = i18n.language?.slice(0, 2) ?? 'et';
  const origin = personOrigin(person, lang);
  const status = personStatusText(person, statusVocab, lang === 'en');
  const href = `/persons/${person.id}`;

  const open = () => navigate(href, { state: { from: location.pathname + location.search } });
  const handleClick = (e: React.MouseEvent) => {
    e.preventDefault();
    if (selectMode) onSelect?.();
    else open();
  };

  return (
    <div
      onClick={handleClick}
      className={`group flex items-center gap-4 px-4 py-3 border-b border-gray-100 last:border-0 cursor-pointer transition-colors ${
        selected ? 'bg-primary-50' : 'hover:bg-primary-50/40'
      } ${selectMode ? 'select-none' : ''}`}
    >
      {selectMode && (
        <span
          className={`w-5 h-5 shrink-0 flex items-center justify-center rounded border transition-colors ${
            selected ? 'bg-primary-600 border-primary-600 text-white' : 'bg-white border-gray-400 text-transparent'
          }`}
          aria-hidden
        >
          <Check size={13} />
        </span>
      )}
      <div className="w-10 h-10 shrink-0 rounded-full overflow-hidden bg-gray-100">
        {person.image_url ? (
          <img
            {...personImageProps(person.image_url, '40px')}
            alt=""
            loading="lazy"
            className="w-full h-full object-cover"
            style={{ objectPosition: 'center 15%' }}
          />
        ) : (
          <Initials name={person.label} textClass="text-sm" />
        )}
      </div>
      <div className="flex-1 min-w-0">
        <a
          href={href}
          onClick={(e) => {
            e.stopPropagation();
            // Ctrl/Cmd-klikk avab uue vahelehe nagu tavaline link
            if (!selectMode && (e.metaKey || e.ctrlKey)) return;
            handleClick(e);
          }}
          className="font-semibold text-gray-900 leading-snug group-hover:text-primary-700"
        >
          {person.label}
        </a>
        <div className="mt-0.5 text-sm text-gray-600 flex flex-wrap gap-x-4 gap-y-0.5">
          <span className="tabular-nums text-gray-500"><Lifespan person={person} /></span>
          {origin.text && <span className="text-gray-500">{origin.text}</span>}
          {status && <span>{status}</span>}
        </div>
      </div>
      <div className="hidden sm:flex items-center gap-3 shrink-0">
        {person.work_count > 0 && (
          <span className="text-xs text-gray-400 tabular-nums">
            {person.work_count} {t('works', { count: person.work_count })}
          </span>
        )}
        <span
          className={`w-2.5 h-2.5 rounded-full ${verificationDotClass(person.verification_level)}`}
          title={person.verification_level}
        />
      </div>
    </div>
  );
};

export default PersonListRow;
