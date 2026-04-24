import React from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { MapPin, ShieldPlus } from 'lucide-react';
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
function resolveLabel(labels: Record<string, string> | null | undefined, lang: string): string | null {
  if (!labels) return null;
  return labels[lang] ?? labels['et'] ?? labels['en'] ?? Object.values(labels)[0] ?? null;
}

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

const CardInner: React.FC<{ person: ProsopoIndexEntry; lifespan: React.ReactNode; onOriginClick?: () => void }> = ({
  person, lifespan, onOriginClick,
}) => {
  const { t, i18n } = useTranslation(['prosopography']);
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
                return (
                  <span key={i} className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-blue-100/90 text-blue-700 border border-blue-200">
                    {label}
                  </span>
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
          const lang = i18n.language?.slice(0, 2) ?? 'et';
          const historical = person.origin_place;
          const modern = resolveLabel(person.origin_place_labels, lang);
          const placeLabel = historical
            ? (modern && modern !== historical ? `${historical} (${modern})` : historical)
            : (modern ?? null);
          const parentLabel = resolveLabel(person.origin_parent?.labels, lang) ?? person.origin_parent?.key;
          const content = placeLabel && parentLabel && placeLabel !== parentLabel
            ? `${placeLabel} · ${parentLabel}`
            : placeLabel;
          if (content && person.origin_coordinates && onOriginClick) {
            return (
              <button
                type="button"
                onClick={e => { e.stopPropagation(); onOriginClick(); }}
                className="inline-flex items-center gap-1 text-xs text-primary-700 hover:text-primary-900 hover:underline text-left"
                title={t('map.openPlace', 'Näita kaardil')}
              >
                <MapPin size={12} />
                {content}
              </button>
            );
          }
          if (placeLabel && parentLabel && placeLabel !== parentLabel) {
            return <p className="text-xs text-gray-400">{placeLabel} · {parentLabel}</p>;
          }
          if (placeLabel) {
            return <p className="text-xs text-gray-400">{placeLabel}</p>;
          }
          if (person.origin_group) {
            const groupLabel = resolveLabel(person.origin_group_labels, lang) ?? person.origin_group;
            return <p className="text-xs text-gray-400">{groupLabel}</p>;
          }
          return null;
        })()}

        {/* Seisus */}
        {(person.status_labels ?? []).length > 0 && (
          <p className="text-sm text-gray-600">{(person.status_labels ?? []).join(', ')}</p>
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
            {person.work_count} {t('works', { count: person.work_count })}
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
  const navigate = useNavigate();

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

  return (
    <div
      role="link"
      tabIndex={0}
      onClick={openPerson}
      onKeyDown={e => e.key === 'Enter' && openPerson()}
      className="bg-white border border-gray-200 rounded-lg shadow-sm hover:shadow-md hover:border-primary-300 transition-all duration-200 flex flex-col overflow-hidden cursor-pointer"
    >
      <CardInner person={person} lifespan={lifespanNode} onOriginClick={openOriginMap} />
    </div>
  );
};

export default PersonCard;
