// src/prosopography/components/PersonWorkParts.tsx
/**
 * Isikulehe teose rea all osa read (#464): „Kiri · Fischerile · 1684 · lk 7–9, 11",
 * link osa esimesele lehele. Piiratud teosel lingita.
 */
import React from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { compactNumbers } from '../../pages/manage/partsModel';
import type { PersonWorkPart } from '../utils/personWorks';

interface Props { workId: string; parts: PersonWorkPart[]; linked: boolean; }

const PersonWorkParts: React.FC<Props> = ({ workId, parts, linked }) => {
  const { t } = useTranslation(['prosopography', 'workspace']);
  if (parts.length === 0) return null;
  return (
    <ul className="ml-6 mb-1 space-y-0.5 border-l border-gray-100 pl-3">
      {parts.map(({ part_id, roles, part }) => {
        const bits = [
          part ? t(`workspace:manage.parts.kinds.${part.kind}`, { defaultValue: part.kind }) : null,
          part?.title || null,
          part?.year ? String(part.year) : null,
          part?.pages.length ? t('network.pages', { pages: compactNumbers(part.pages) }) : null,
        ].filter(Boolean).join(' · ');
        const roleLabel = roles.map(r => t(`workspace:metadata.roles.${r}`, { defaultValue: r })).join(', ');
        const label = <span className="truncate">{bits || part_id}</span>;
        return (
          <li key={part_id} className="flex items-center justify-between gap-3 py-0.5 text-xs">
            {linked
              ? <Link to={`/work/${workId}/${part?.first_page ?? 1}`} className="min-w-0 text-gray-600 hover:text-primary-700 truncate">{label}</Link>
              : <span className="min-w-0 text-gray-500 truncate">{label}</span>}
            {roleLabel && <span className="shrink-0 rounded bg-gray-100 px-1.5 py-0.5 text-gray-400">{roleLabel}</span>}
          </li>
        );
      })}
    </ul>
  );
};

export default PersonWorkParts;
