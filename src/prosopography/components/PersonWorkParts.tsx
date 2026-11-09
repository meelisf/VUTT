// src/prosopography/components/PersonWorkParts.tsx
/**
 * Isikulehe teose rea all osa read (#464): „Kiri · Fischerile · 1684 · lk 7–9, 11",
 * link osa esimesele lehele. Piiratud teosel lingita.
 *
 * Osad rühmitatakse isiku rolli järgi. Rühm, kus on üle COLLAPSE_AFTER osa, on
 * kokkuklapitud kokkuvõtterida („120 kirja · 1661–1704" + roll), mis avab loendi;
 * roll on siis ainult kokkuvõttes, mitte igal real. Väiksem rühm on kohe lahti.
 */
import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ChevronRight } from 'lucide-react';
import { compactNumbers } from '../../pages/manage/partsModel';
import type { PersonWorkPart } from '../utils/personWorks';

interface Props { workId: string; parts: PersonWorkPart[]; linked: boolean; }

export const COLLAPSE_AFTER = 3;

const badgeCls = 'shrink-0 rounded bg-gray-100 px-1.5 py-0.5 text-gray-400';

/** Rollirühmad esmaesinemise järjekorras (rollide järjekord rühma võtmes ei loe). */
function groupByRoles(parts: PersonWorkPart[]): PersonWorkPart[][] {
  const groups = new Map<string, PersonWorkPart[]>();
  for (const p of parts) {
    const key = [...p.roles].sort().join('|');
    const g = groups.get(key);
    if (g) g.push(p); else groups.set(key, [p]);
  }
  return [...groups.values()];
}

/** Aastavahemik „1661–1704" / „1678" / null. */
function yearSpan(parts: PersonWorkPart[]): string | null {
  const years = parts.map(p => p.part?.year).filter((y): y is number => Boolean(y));
  if (!years.length) return null;
  const lo = Math.min(...years), hi = Math.max(...years);
  return lo === hi ? String(lo) : `${lo}–${hi}`;
}

interface GroupProps extends Props { roleLabel: string; }

const PartGroup: React.FC<GroupProps> = ({ workId, parts, linked, roleLabel }) => {
  const { t } = useTranslation(['prosopography', 'workspace']);
  const collapsible = parts.length > COLLAPSE_AFTER;
  const [open, setOpen] = useState(false);

  const list = (
    <ul className="ml-6 mb-1 space-y-0.5 border-l border-gray-100 pl-3">
      {parts.map(({ part_id, part }) => {
        const bits = [
          part ? t(`workspace:manage.parts.kinds.${part.kind}`, { defaultValue: part.kind }) : null,
          part?.title || null,
          part?.year ? String(part.year) : null,
          part?.pages.length ? t('network.pages', { pages: compactNumbers(part.pages) }) : null,
        ].filter(Boolean).join(' · ');
        const label = <span className="truncate" title={bits || part_id}>{bits || part_id}</span>;
        return (
          <li key={part_id} className="flex items-center justify-between gap-3 py-0.5 text-xs">
            {linked
              ? <Link to={`/work/${workId}/${part?.first_page ?? 1}`} className="min-w-0 text-gray-600 hover:text-primary-700 truncate">{label}</Link>
              : <span className="min-w-0 text-gray-500 truncate">{label}</span>}
            {!collapsible && roleLabel && <span className={badgeCls}>{roleLabel}</span>}
          </li>
        );
      })}
    </ul>
  );
  if (!collapsible) return list;

  const allLetters = parts.every(p => p.part?.kind === 'letter');
  const summary = [
    t(allLetters ? 'network.partsLetters' : 'network.partsCount', { count: parts.length }),
    yearSpan(parts),
  ].filter(Boolean).join(' · ');

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
        className="ml-6 mb-1 flex w-[calc(100%-1.5rem)] items-center justify-between gap-3 rounded py-0.5 pl-3 text-xs text-gray-500 hover:text-primary-700"
      >
        <span className="flex min-w-0 items-center gap-1">
          <ChevronRight size={12} className={`shrink-0 transition-transform ${open ? 'rotate-90' : ''}`} />
          <span className="truncate">{summary}</span>
        </span>
        {roleLabel && <span className={badgeCls}>{roleLabel}</span>}
      </button>
      {open && list}
    </div>
  );
};

const PersonWorkParts: React.FC<Props> = ({ workId, parts, linked }) => {
  const { t } = useTranslation(['prosopography', 'workspace']);
  if (parts.length === 0) return null;
  return (
    <>
      {groupByRoles(parts).map(group => (
        <PartGroup
          key={group[0].part_id}
          workId={workId}
          parts={group}
          linked={linked}
          roleLabel={group[0].roles.map(r => t(`workspace:metadata.roles.${r}`, { defaultValue: r })).join(', ')}
        />
      ))}
    </>
  );
};

export default PersonWorkParts;
