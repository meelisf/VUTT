import React from 'react';
import { BookOpen } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import type { PersonSource, ProsopoRecord } from '../types';
import { evidenceSources } from '../utils/evidenceRef';
import type { WorkInfo } from '../hooks/useWorkTitles';
import {
  hasSourceContent, isVuttSource, linkifyCitation, partLabel, sourceHref, splitCitationKey, type SourcePartsMap,
} from '../utils/personSources';

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

/** Vabatekst, kus URL-id ja DOI-d on lingid. */
function LinkedText({ text }: { text: string }) {
  return (
    <>
      {linkifyCitation(text).map((part, i) => part.kind === 'link'
        ? <a key={i} href={part.href} target="_blank" rel="noopener noreferrer"
             className="text-primary-700 underline decoration-gray-300 hover:decoration-primary-600 break-words">{part.text}</a>
        : <React.Fragment key={i}>{part.text}</React.Fragment>)}
    </>
  );
}

const Note = ({ note }: { note?: string | null }) => note
  ? <span className="block mt-0.5 text-xs italic text-gray-500"><LinkedText text={note} /></span>
  : null;

/** Kirjanduse kirje: lühivõti (põhiteksti viide „Küng 2010: 95") vasakus veerus. */
export function LiteratureSourceLine({ source }: { source: PersonSource }) {
  const { key, rest } = splitCitationKey(source.text ?? '');
  return (
    <div className="sm:grid sm:grid-cols-[9.5rem_1fr] sm:gap-x-3">
      {key ? <span className="font-semibold text-gray-900 sm:text-right">{key}</span> : <span className="hidden sm:block" />}
      <div className="text-gray-700">
        {key && <span className="sm:hidden"> — </span>}
        <LinkedText text={rest} />
        <Note note={source.note} />
      </div>
    </div>
  );
}

/** VUTT-i kirje: link on täiendus (mida sellest teosest kasutati), all hallilt teose
 *  pealkiri (kärbitud) · aasta · osa · lk. Täienduseta kirjel on lingiks pealkiri. */
export function VuttSourceLine({ source, works, parts }: {
  source: PersonSource & { work_id: string }; works: Record<string, WorkInfo>; parts: SourcePartsMap;
}) {
  const { t } = useTranslation('prosopography');
  const work = works[source.work_id];
  const title = work?.title || source.work_id;
  const part = source.part_id ? parts[source.work_id]?.[source.part_id] : undefined;
  const label = source.text?.trim();
  const meta = [
    work?.year ? String(work.year) : null,
    part ? partLabel(part, work?.title) : null,
    source.printed_page ? `${t('agentEnrichment.page')} ${source.printed_page}` : null,
  ].filter(Boolean).join(' · ');
  return (
    <div>
      <Link to={sourceHref(source, parts)} title={label ? title : undefined}
            className={`font-medium text-primary-700 hover:text-primary-900 hover:underline ${label ? '' : 'line-clamp-2'}`}>
        {label || title}
      </Link>
      {label && <span className="text-xs text-gray-500 line-clamp-2" title={title}>{title}</span>}
      {meta && <span className="block text-xs text-gray-500">{meta}</span>}
      <Note note={source.note} />
    </div>
  );
}

const GroupLabel = ({ children }: { children: React.ReactNode }) => (
  <span className="text-gray-500 block text-xs uppercase tracking-wide mb-2">{children}</span>
);

/** Isikulehe „Allikad ja bibliograafia": kirjandus, VUTT-i allikad, tõenditest kogutud. */
export default function PersonSourcesCard({ person, workTitles, works = {}, parts = {} }: {
  person: ProsopoRecord; workTitles: Record<string, string>;
  works?: Record<string, WorkInfo>; parts?: SourcePartsMap;
}) {
  const { t } = useTranslation('prosopography');
  const manual = (person.sources ?? []).filter(hasSourceContent);
  const literature = manual.filter(source => !isVuttSource(source));
  const vutt = manual.filter(isVuttSource);
  const entries: Entries = [...(person.occupations ?? []), ...(person.education ?? [])];
  const hasEvidence = evidenceSources(entries, id => workTitles[id]).length > 0;
  if (!manual.length && !hasEvidence) return null;
  // Pealkiri: allikate päring (aastaga) või tõendite oma.
  const workInfo: Record<string, WorkInfo> = { ...Object.fromEntries(
    Object.entries(workTitles).map(([id, title]) => [id, { title, year: null }])), ...works };
  return (
    <div className="bg-white p-5 rounded-lg border border-gray-200 shadow-sm mb-6">
      <div className="flex items-center gap-2 mb-3 text-gray-800">
        <span className="text-primary-600"><BookOpen size={18} /></span>
        <span className="font-bold">{t('bibliography')}</span>
      </div>
      <div className="space-y-5 border-t border-gray-100 pt-4 text-sm">
        {literature.length > 0 && (
          <section>
            <GroupLabel>{t('bibliographyLiterature')}</GroupLabel>
            <ul className="space-y-2.5">
              {literature.map((source, i) => <li key={i}><LiteratureSourceLine source={source} /></li>)}
            </ul>
          </section>
        )}
        {vutt.length > 0 && (
          <section>
            <GroupLabel>{t('bibliographyVutt')}</GroupLabel>
            <ul className="space-y-3">
              {vutt.map((source, i) => (
                <li key={i}><VuttSourceLine source={source} works={workInfo} parts={parts} /></li>
              ))}
            </ul>
          </section>
        )}
        <EvidenceSourceList entries={entries} titleOf={id => workTitles[id]} />
      </div>
    </div>
  );
}
