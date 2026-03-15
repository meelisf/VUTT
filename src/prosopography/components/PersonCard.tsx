import React from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type { ProsopoIndexEntry } from '../types';

interface PersonCardProps {
  person: ProsopoIndexEntry;
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

// Initsiaalid varufotona (nagu WorkCard thumbnail fallback)
const Initials: React.FC<{ name: string }> = ({ name }) => {
  const parts = name.trim().split(/\s+/);
  const initials = parts.length >= 2
    ? (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
    : name.slice(0, 2).toUpperCase();
  return (
    <div className="w-full h-full flex items-center justify-center bg-gray-100">
      <span className="text-3xl font-bold text-gray-300 select-none">{initials}</span>
    </div>
  );
};

const PersonCard: React.FC<PersonCardProps> = ({ person }) => {
  const { t } = useTranslation(['common']);

  const lifespan = (() => {
    const b = person.birth_year ? `*${person.birth_year}` : '';
    const d = person.death_year ? `†${person.death_year}` : '';
    if (b && d) return `${b}  ${d}`;
    if (b) return b;
    if (d) return d;
    return t('prosopography.unknownYears', 'eluaastad teadm.');
  })();

  return (
    <Link
      to={`/persons/${person.id}`}
      className="bg-white border border-gray-200 rounded-lg shadow-sm hover:shadow-md hover:border-primary-300 transition-all duration-200 flex flex-col overflow-hidden"
    >
      {/* Foto ala — nagu WorkCard h-40 thumbnail */}
      <div className="h-40 bg-gray-100 relative overflow-hidden">
        {person.image_url ? (
          <img
            src={person.image_url}
            alt={person.label}
            loading="lazy"
            className="w-full h-full object-cover object-top opacity-90 group-hover:opacity-100 transition-opacity"
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
              {person.work_count} {t('prosopography.works', 'teost')}
            </span>
          )}

          <span
            className={`block w-2.5 h-2.5 rounded-full shrink-0 ${getStatusDotStyle(person.verification_level)}`}
            title={person.verification_level}
          />
        </div>
      </div>
    </Link>
  );
};

export default PersonCard;
