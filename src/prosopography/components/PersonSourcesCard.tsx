import { BookOpen } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import type { ProsopoRecord } from '../types';
import { evidenceSources } from '../utils/evidenceRef';

type Entries = Array<{ evidence?: unknown }>;

/** Ametite ja hariduse tõendites kasutatud allikad kordusteta — ainult lugemiseks;
 *  tõend ise elab faktireal (isikulehel joonealuse viitena). */
export function EvidenceSourceList({ entries, titleOf }: {
  entries: Entries; titleOf: (workId: string) => string | undefined;
}) {
  const { t } = useTranslation('prosopography');
  const sources = evidenceSources(entries, titleOf);
  if (!sources.length) return null;
  return (
    <div className="text-sm">
      <span className="text-gray-500 block text-xs uppercase tracking-wide mb-1">{t('evidenceSourcesUsed')}</span>
      <ul className="space-y-0.5 text-gray-700">
        {sources.map(source => (
          <li key={source.key}>
            {source.href && !source.external
              ? <Link to={source.href} className="underline hover:text-gray-900">{source.title}</Link>
              : source.href
                ? <a href={source.href} target="_blank" rel="noopener noreferrer" className="underline">{source.title}</a>
                : source.title}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Isikulehe „Allikad ja bibliograafia": käsitsi loend (`sources`) + tõenditest kogutud. */
export default function PersonSourcesCard({ person, workTitles }: {
  person: ProsopoRecord; workTitles: Record<string, string>;
}) {
  const { t } = useTranslation('prosopography');
  const manual = (person.sources ?? []).filter(source => source?.text?.trim());
  const entries: Entries = [...(person.occupations ?? []), ...(person.education ?? [])];
  const hasEvidence = evidenceSources(entries, id => workTitles[id]).length > 0;
  if (!manual.length && !hasEvidence) return null;
  return (
    <div className="bg-white p-5 rounded-lg border border-gray-200 shadow-sm mb-6">
      <div className="flex items-center gap-2 mb-3 text-gray-800">
        <span className="text-primary-600"><BookOpen size={18} /></span>
        <span className="font-bold">{t('bibliography')}</span>
      </div>
      <div className="space-y-3 border-t border-gray-100 pt-3">
        {manual.length > 0 && (
          <ul className="space-y-1 text-sm text-gray-800">
            {manual.map((source, i) => (
              <li key={i}>
                {source.text}
                {source.note && <span className="block text-xs italic text-gray-500">{source.note}</span>}
              </li>
            ))}
          </ul>
        )}
        <EvidenceSourceList entries={entries} titleOf={id => workTitles[id]} />
      </div>
    </div>
  );
}
