import React from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type { ProsopoIndexEntry } from '../types';

interface PersonCardProps {
  person: ProsopoIndexEntry;
}

const VerificationDot: React.FC<{ level: string }> = ({ level }) => {
  const colors: Record<string, string> = {
    verified: 'bg-emerald-500',
    reviewed: 'bg-amber-400',
    draft:    'bg-gray-300',
  };
  const labels: Record<string, string> = {
    verified: 'verified',
    reviewed: 'reviewed',
    draft:    'draft',
  };
  return (
    <span className="flex items-center gap-1">
      <span className={`inline-block w-1.5 h-1.5 rounded-full ${colors[level] ?? 'bg-gray-300'}`} />
      <span className="text-gray-400">{labels[level] ?? level}</span>
    </span>
  );
};

const ExternalBadge: React.FC<{ label: string }> = ({ label }) => (
  <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold tracking-wide bg-primary-50 text-primary-700 border border-primary-200">
    {label}
  </span>
);

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

  const statusLine = [person.status_label].filter(Boolean).join(' · ');

  return (
    <Link
      to={`/persons/${person.id}`}
      className="group block bg-paper border border-stone-200 rounded-lg hover:border-primary-300 hover:shadow-md transition-all duration-150 overflow-hidden"
    >
      {/* Ülemine triip — verification värv */}
      <div className={`h-0.5 w-full ${
        person.verification_level === 'verified' ? 'bg-emerald-400' :
        person.verification_level === 'reviewed' ? 'bg-amber-400' :
        'bg-stone-200'
      }`} />

      <div className="p-4 flex flex-col gap-2.5">
        {/* Nimi */}
        <div>
          <h3 className="font-serif text-base font-semibold text-gray-900 leading-snug group-hover:text-primary-700 transition-colors">
            {person.label}
          </h3>
          <p className="text-xs text-gray-500 font-medium mt-0.5 tracking-wide">
            {lifespan}
          </p>
        </div>

        {/* Seisus / konfessioon */}
        {statusLine && (
          <p className="text-xs text-gray-600 leading-relaxed">{statusLine}</p>
        )}

        {/* Biograafia snippet */}
        {person.biography_snippet && (
          <p className="text-xs text-gray-500 italic leading-relaxed line-clamp-2 border-l-2 border-stone-200 pl-2">
            „{person.biography_snippet}…"
          </p>
        )}

        {/* Alumine rida */}
        <div className="flex items-center justify-between pt-1 border-t border-stone-100">
          <div className="flex items-center gap-1.5">
            {person.has_wikidata && <ExternalBadge label="WD" />}
            {person.has_gnd     && <ExternalBadge label="GND" />}
            {person.has_aa      && <ExternalBadge label="AA" />}
          </div>
          <div className="flex items-center gap-2.5">
            {person.work_count > 0 && (
              <span className="text-xs text-gray-400">
                {person.work_count} {t('prosopography.works', 'teost')}
              </span>
            )}
            <VerificationDot level={person.verification_level} />
          </div>
        </div>
      </div>
    </Link>
  );
};

export default PersonCard;
