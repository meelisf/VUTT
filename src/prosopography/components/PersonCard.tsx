import React from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import PersonSnippet from './PersonSnippet';
import { MapPin, ShieldPlus } from 'lucide-react';
import type { ProsopoIndexEntry } from '../types';
import type { VocabularySeisusItem } from '../../services/collectionService';
import { Initials, Lifespan, verificationDotClass, personOrigin, personStatusText } from '../utils/personDisplay';
import { personImageProps } from '../utils/personImage';

interface PersonCardProps {
  person: ProsopoIndexEntry;
  selectMode?: boolean;
  selected?: boolean;
  onSelect?: (id: string) => void;
  /** Seisuste sõnavara (id → {et,en}), laetakse PersonsPage'is; kasutatakse seisuse lokaliseerimiseks. */
  statusVocab?: VocabularySeisusItem[];
}

const ExternalBadge: React.FC<{ label: string }> = ({ label }) => (
  <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold tracking-wide bg-primary-50 text-primary-700 border border-primary-200">
    {label}
  </span>
);

// Kaardi sisu — kasutatakse nii Link- kui select-režiimis
function formatImmLabel(dateStr: string, lang: string): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  if (!y) return `AA ${dateStr}`;
  try {
    const date = new Date(y, (m || 1) - 1, d || 1);
    const opts: Intl.DateTimeFormatOptions = d
      ? { day: 'numeric', month: 'long', year: 'numeric' }
      : { month: 'long', year: 'numeric' };
    return `AA ${date.toLocaleDateString(lang === 'et' ? 'et-EE' : 'en-GB', opts)}`;
  } catch {
    return `AA ${y}`;
  }
}

const CardInner: React.FC<{
  person: ProsopoIndexEntry;
  lifespan: React.ReactNode;
  onOriginClick?: () => void;
  onTagClick?: (value: string) => void;
  statusVocab?: VocabularySeisusItem[];
}> = ({
  person, lifespan, onOriginClick, onTagClick, statusVocab,
}) => {
  const { t, i18n } = useTranslation(['prosopography']);
  return (
  <>
    {/* Foto ala — nagu WorkCard h-40 thumbnail */}
    <div className="h-40 bg-gray-100 relative overflow-hidden">
      {person.image_url ? (
        <img
          {...personImageProps(person.image_url, '(min-width: 1280px) 25vw, (min-width: 1024px) 33vw, (min-width: 640px) 50vw, 100vw')}
          alt={person.label}
          loading="lazy"
          className="w-full h-full object-cover opacity-90 group-hover:opacity-100 transition-opacity"
          style={{ objectPosition: 'center 15%' }}
        />
      ) : (
        <Initials name={person.label} />
      )}
      {(person.status_ids ?? []).includes('Q134737') && (
        <span className="absolute top-2 right-2 p-1 rounded-full bg-amber-100/90 text-amber-600 border border-amber-200/80" title={t('nobility', 'Aadel')}>
          <ShieldPlus size={14} />
        </span>
      )}
      {/* Immatrikuleerumine + tagid — alumine vasak nurk */}
      {(person.imm_date || (person.tags ?? []).length > 0) && (
        <div className="absolute bottom-2 left-2 flex flex-col gap-1 max-w-[calc(100%-1rem)]">
          {person.imm_date && (
            <span className="self-start px-1.5 py-0.5 rounded text-[10px] font-medium bg-gray-100 text-gray-600 border border-gray-200">
              {formatImmLabel(person.imm_date, i18n.language?.slice(0, 2) ?? 'et')}
            </span>
          )}
          {(person.tags ?? []).length > 0 && (
            <div className="flex flex-wrap gap-1">
              {(person.tags ?? []).map((tag, i) => {
                const lang = i18n.language?.slice(0, 2) ?? 'et';
                const label = tag.labels?.[lang] ?? tag.labels?.en ?? tag.label;
                const value = tag.id || tag.label;
                const chipClass = 'px-1.5 py-0.5 rounded text-[10px] font-medium bg-blue-100/90 text-blue-700 border border-blue-200';
                // Valikurežiimis onTagClick puudub → silt jääb passiivseks (sama muster mis onOriginClick).
                if (!onTagClick || !value) {
                  return <span key={i} className={chipClass}>{label}</span>;
                }
                return (
                  <button
                    key={i}
                    type="button"
                    onClick={e => { e.stopPropagation(); onTagClick(value); }}
                    className={`${chipClass} hover:bg-blue-200 transition-colors`}
                    title={t('filterTags')}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>

    <div className="p-4 flex-1 flex flex-col">
      {/* Nimi */}
      <h3 className="text-lg font-bold text-gray-900 mb-1 leading-tight">
        {person.label}
      </h3>

      <div className="mt-1 space-y-1.5 flex-1">
        {/* Eluaastad */}
        <p className="text-sm text-gray-500">{lifespan}</p>

        {/* Päritolukoht */}
        {(() => {
          const origin = personOrigin(person, i18n.language?.slice(0, 2) ?? 'et');
          if (!origin.text) return null;
          if (origin.hasPlace && person.origin_coordinates && onOriginClick) {
            return (
              <button
                type="button"
                onClick={e => { e.stopPropagation(); onOriginClick(); }}
                className="inline-flex items-center gap-1 text-xs text-primary-700 hover:text-primary-900 hover:underline text-left"
                title={t('map.openPlace', 'Näita kaardil')}
              >
                <MapPin size={12} />
                {origin.text}
              </button>
            );
          }
          return <p className="text-xs text-gray-400">{origin.text}</p>;
        })()}

        {/* Seisus — lokaliseeritud aktiivses keeles (status_ids → sõnavara), varuks status_labels (eesti) */}
        {(person.status_ids ?? person.status_labels ?? []).length > 0 && (
          <p className="text-sm text-gray-600">
            {personStatusText(person, statusVocab, !!i18n.language?.startsWith('en'))}
          </p>
        )}

        {/* Katke: ahela valib vaade, mitte indeks */}
        <PersonSnippet entry={person} lang={i18n.language?.startsWith('en') ? 'en' : 'et'} />

      </div>

      {/* Alumine rida — nagu WorkCard */}
      <div className="mt-4 pt-3 border-t border-gray-100 flex items-center gap-1.5 min-w-0">
        <div className="flex items-center gap-1 flex-1 min-w-0">
          {person.has_wikidata && <ExternalBadge label="WD" />}
          {person.has_gnd     && <ExternalBadge label="GND" />}
          {person.has_aa      && <ExternalBadge label="AA" />}
        </div>

        {person.work_count > 0 && (
          <span className="text-xs text-gray-400 shrink-0">
            {person.work_count} {t('works', { count: person.work_count })}
          </span>
        )}

        <span
          className={`block w-2.5 h-2.5 rounded-full shrink-0 ${verificationDotClass(person.verification_level)}`}
          title={person.verification_level}
        />
      </div>
    </div>
  </>
  );
};

const PersonCard: React.FC<PersonCardProps> = ({ person, selectMode, selected, onSelect, statusVocab }) => {
  const location = useLocation();
  const navigate = useNavigate();

  const lifespanNode = <Lifespan person={person} />;

  if (selectMode) {
    return (
      <div
        role="button"
        tabIndex={0}
        onClick={() => onSelect?.(person.id)}
        onKeyDown={e => e.key === 'Enter' && onSelect?.(person.id)}
        className={`relative bg-white border-2 rounded-lg shadow-sm cursor-pointer transition-all duration-200 flex flex-col overflow-hidden ${
          selected
            ? 'border-primary-500 ring-2 ring-primary-200'
            : 'border-gray-200 hover:border-primary-300'
        }`}
      >
        {/* Checkbox overlay */}
        <div className={`absolute top-2.5 right-2.5 z-10 w-5 h-5 rounded border-2 flex items-center justify-center transition-colors ${
          selected ? 'bg-primary-600 border-primary-600' : 'bg-white/80 border-gray-300'
        }`}>
          {selected && (
            <svg viewBox="0 0 10 8" fill="none" className="w-3 h-3">
              <path d="M1 4l3 3 5-6" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          )}
        </div>
        <CardInner person={person} lifespan={lifespanNode} statusVocab={statusVocab} />
      </div>
    );
  }

  const openPerson = () => {
    navigate(`/persons/${person.id}`, { state: { from: location.pathname + location.search } });
  };

  const openOriginMap = () => {
    if (!person.origin_place) return;
    const params = new URLSearchParams(location.search);
    params.set('view', 'map');
    params.set('focus_place', person.origin_place);
    params.delete('offset');
    navigate(`/persons?${params.toString()}`);
  };

  const openTagFilter = (value: string) => {
    const params = new URLSearchParams();
    params.append('tag', value);
    navigate(`/persons?${params.toString()}`);
  };

  return (
    <div
      role="link"
      tabIndex={0}
      onClick={openPerson}
      onKeyDown={e => e.key === 'Enter' && openPerson()}
      className="bg-white border border-gray-200 rounded-lg shadow-sm hover:shadow-md hover:border-primary-300 transition-all duration-200 flex flex-col overflow-hidden cursor-pointer"
    >
      <CardInner person={person} lifespan={lifespanNode} onOriginClick={openOriginMap} onTagClick={openTagFilter} statusVocab={statusVocab} />
    </div>
  );
};

export default PersonCard;
