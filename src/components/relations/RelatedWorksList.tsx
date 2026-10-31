import React from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { X } from 'lucide-react';
import type { ResolvedRelation } from '../../types';
import { formatYearDisplay } from '../../utils/yearDisplayUtils';
import { workDisplayTitle } from '../../utils/workTitle';

interface RelatedWorksListProps {
  items: ResolvedRelation[];
  lang: string;
  /** Ainult toimetajale: ✕ iga rea kõrval. */
  onRemove?: (rel: ResolvedRelation) => void;
  /** Ülekate tumedal taustal (kaart) vs infopaneel heledal. */
  dark?: boolean;
}

/** Seotud teosed liigi kaupa — ühine infopaneelile ja kaardi ülekattele (ADR 0075). */
const RelatedWorksList: React.FC<RelatedWorksListProps> = ({ items, lang, onRemove, dark = false }) => {
  const { t } = useTranslation(['common']);
  // Kustutatud sihtteos (`missing`) jäetakse vahele.
  const visible = items.filter(r => !r.missing);
  if (visible.length === 0) return null;
  const types = Array.from(new Set(visible.map(r => r.rel_type)));
  const muted = dark ? 'text-gray-400' : 'text-gray-500';
  return (
    <div className="space-y-2">
      {types.map(type => (
        <div key={type}>
          <p className={`text-[11px] ${muted} mb-1`}>{t(`common:workRelations.types.${type}`, 'Variant')}</p>
          <ul className="space-y-1">
            {visible.filter(r => r.rel_type === type).map(r => {
              const title = workDisplayTitle(r, lang).main;
              const year = formatYearDisplay(r.year_display, r.year, t, r.dating);
              const meta = [year, r.archive_ref].filter(Boolean).join(' · ');
              return (
                <li key={r.id} className="flex items-start gap-1.5 text-sm">
                  <span className={muted}>→</span>
                  <span className="min-w-0 flex-1">
                    {r.readable ? (
                      <Link to={`/work/${r.id}/1`} onClick={e => e.stopPropagation()}
                            className={`${dark ? 'text-white hover:text-emerald-200' : 'text-primary-700 hover:text-primary-900'} hover:underline line-clamp-2`}>
                        {title}
                      </Link>
                    ) : (
                      <span className={`${dark ? 'text-gray-200' : 'text-gray-700'} line-clamp-2`}>{title}</span>
                    )}
                    <span className={`block text-xs ${muted}`}>
                      {meta}
                      {!r.readable && <span className="ml-1 italic">{t('common:workRelations.restricted', 'piiratud ligipääs')}</span>}
                    </span>
                  </span>
                  {onRemove && (
                    <button type="button" onClick={() => onRemove(r)}
                            aria-label={t('common:workRelations.remove', 'Eemalda seos')}
                            className="p-0.5 text-gray-400 hover:text-red-600 rounded shrink-0">
                      <X size={14} />
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </div>
  );
};

export default RelatedWorksList;
