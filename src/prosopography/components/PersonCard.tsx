import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type { ProsopoIndexEntry } from '../types';

interface PersonCardProps {
  person: ProsopoIndexEntry;
  selectMode?: boolean;
  selected?: boolean;
  onSelect?: (id: string) => void;
}

const ExternalBadge: React.FC<{ label: string }> = ({ label }) => (
  <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold tracking-wide bg-primary-50 text-primary-700 border border-primary-200">
    {label}
  </span>
);

const getStatusDotStyle = (level: string) => {
  switch (level) {
    case 'verified': return 'bg-green-500';
    case 'reviewed': return 'bg-amber-400';
    default:         return 'bg-gray-300';
  }
};

// Deterministlik taustavärv nime põhjal (igal isikul unikaalne muted toon)
const nameToColor = (name: string): { bg: string; fg: string } => {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  const hue = Math.abs(hash) % 360;
  return {
    bg: `hsl(${hue}, 20%, 90%)`,
    fg: `hsl(${hue}, 25%, 52%)`,
  };
};

// Initsiaalid varufotona (nagu WorkCard thumbnail fallback)
const Initials: React.FC<{ name: string }> = ({ name }) => {
  const parts = name.trim().split(/\s+/);
  const initials = parts.length >= 2
    ? (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
    : name.slice(0, 2).toUpperCase();
  const { bg, fg } = nameToColor(name);
  return (
    <div className="w-full h-full flex items-center justify-center" style={{ backgroundColor: bg }}>
      <span className="text-3xl font-bold select-none" style={{ color: fg }}>{initials}</span>
    </div>
  );
};

// Kaardi sisu — kasutatakse nii Link- kui select-režiimis
const CardInner: React.FC<{ person: ProsopoIndexEntry; lifespan: React.ReactNode }> = ({
  person, lifespan,
}) => {
  const { t } = useTranslation(['prosopography']);
  return (
  <>
    {/* Foto ala — nagu WorkCard h-40 thumbnail */}
    <div className="h-40 bg-gray-100 relative overflow-hidden">
      {person.image_url ? (
        <img
          src={person.image_url}
          alt={person.label}
          loading="lazy"
          className="w-full h-full object-cover opacity-90 group-hover:opacity-100 transition-opacity"
          style={{ objectPosition: 'center 15%' }}
        />
      ) : (
        <Initials name={person.label} />
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

        {/* Seisus */}
        {person.status_label && (
          <p className="text-sm text-gray-600">{person.status_label}</p>
        )}

        {/* Biograafia snippet */}
        {person.biography_snippet && (
          <p className="text-xs text-gray-500 italic leading-relaxed line-clamp-2 border-l-2 border-gray-200 pl-2 mt-2">
            „{person.biography_snippet}…"
          </p>
        )}
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
            {t('works', { count: person.work_count })}
          </span>
        )}

        <span
          className={`block w-2.5 h-2.5 rounded-full shrink-0 ${getStatusDotStyle(person.verification_level)}`}
          title={person.verification_level}
        />
      </div>
    </div>
  </>
  );
};

const PersonCard: React.FC<PersonCardProps> = ({ person, selectMode, selected, onSelect }) => {
  const { t } = useTranslation(['prosopography']);
  const location = useLocation();

  const lifespanNode = (() => {
    const sym = 'text-primary-500';
    const b = person.birth_year ? <><span className={sym}>*</span>{person.birth_year}</> : null;
    const d = person.death_year ? <><span className={sym}>†</span>{person.death_year}</> : null;
    if (b && d) return <>{b}{'  '}{d}</>;
    if (b) return b;
    if (d) return d;
    return <span>{t('unknownYears', 'eluaastad teadm.')}</span>;
  })();

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
        <CardInner person={person} lifespan={lifespanNode} />
      </div>
    );
  }

  return (
    <Link
      to={`/persons/${person.id}`}
      state={{ from: location.pathname + location.search }}
      className="bg-white border border-gray-200 rounded-lg shadow-sm hover:shadow-md hover:border-primary-300 transition-all duration-200 flex flex-col overflow-hidden"
    >
      <CardInner person={person} lifespan={lifespanNode} />
    </Link>
  );
};

export default PersonCard;
