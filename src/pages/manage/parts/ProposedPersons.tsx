/**
 * Agendi pakutud uued isikud (#492): toimetaja loob kaardi (create_person_checked,
 * `created_via: agent` → isikute ülevaatusjärjekord), seob olemasolevaga või jätab nimeks.
 * Lahendatud isik läheb osa vastuvõtul osa isikute juurde ID-na.
 */
import React, { useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { UserPlus, Link2, Type } from 'lucide-react';
import PersonAddPanel from '../../../prosopography/components/PersonAddPanel';
import { resolveProposedPerson, type ProposedPerson } from '../../../services/workPartsApi';
import BusyNote from '../../../components/BusyNote';

const ID_URL: Record<string, (id: string) => string> = {
  gnd: id => `https://d-nb.info/gnd/${id}`,
  wikidata: id => `https://www.wikidata.org/wiki/${id}`,
  viaf: id => `https://viaf.org/viaf/${id}`,
};

interface Props {
  workId: string;
  token: string | null;
  lang: string;
  entries: { proposalId: string; person: ProposedPerson }[];
  onResolved: () => void;
}

const ProposedPersons: React.FC<Props> = ({ workId, token, lang, entries, onResolved }) => {
  const { t } = useTranslation(['workspace']);
  const tp = (key: string, opts?: Record<string, unknown>) => t(`manage.parts.proposals.${key}`, opts);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [exists, setExists] = useState<{ key: string; ids: string[] } | null>(null);
  const [linking, setLinking] = useState<{ proposalId: string; person: ProposedPerson } | null>(null);

  const act = async (proposalId: string, person: ProposedPerson, action: 'create' | 'link' | 'name', personId?: string) => {
    setBusy(true);
    setError(null);
    setExists(null);
    try {
      await resolveProposedPerson(workId, proposalId, person.ref, action, token, personId);
      onResolved();
    } catch (e) {
      const msg = (e as Error).message;
      // Väline ID on juba teisel kaardil: paku sidumist selle isikuga.
      if (msg.startsWith('person_exists:')) setExists({ key: `${proposalId}/${person.ref}`, ids: msg.slice(14).split(',') });
      else setError(msg);
    } finally {
      setBusy(false);
    }
  };

  const pending = entries.filter(e => e.person.status === 'pending');
  if (pending.length === 0) return null;

  return (
    <div className="mt-2 rounded border border-violet-100 bg-white p-2">
      <h4 className="text-xs font-semibold uppercase tracking-wide text-violet-900">{tp('persons', { count: pending.length })}</h4>
      <p className="text-xs text-gray-500">{tp('personsHelp')}</p>
      {busy && <BusyNote className="mt-1">{tp('working')}</BusyNote>}
      {error && <p role="alert" className="mt-1 text-xs text-red-700">{error}</p>}
      <ul className="mt-1.5 space-y-1.5">
        {pending.map(({ proposalId, person: p }) => {
          const key = `${proposalId}/${p.ref}`;
          const years = p.birth_year || p.death_year ? `${p.birth_year ?? '?'}–${p.death_year ?? '?'}` : '';
          return (
            <li key={key} className="flex flex-wrap items-start gap-2 border-t border-gray-100 pt-1.5 first:border-0 first:pt-0">
              <div className="min-w-0 flex-1 text-sm">
                <span className="font-medium text-gray-900">{p.name}</span>
                {years && <span className="ml-2 tabular-nums text-gray-500">{years}</span>}
                {(p.identifiers ?? []).map(i => (
                  <a key={`${i.scheme}${i.id}`} href={ID_URL[i.scheme]?.(i.id)} target="_blank" rel="noopener noreferrer"
                    className="ml-2 text-xs text-primary-700 hover:underline">{i.scheme.toUpperCase()} {i.id}</a>
                ))}
                {!!p.aliases?.length && <div className="text-xs text-gray-500">{p.aliases.join(', ')}</div>}
                {p.note && <div className="text-xs text-gray-600">{p.note}</div>}
                {p.evidence?.[0]?.quote && <div className="text-xs italic text-gray-500">„{p.evidence[0].quote}" ({tp('pages', { pages: p.evidence[0].page })})</div>}
                {exists?.key === key && (
                  <div className="mt-1 text-xs text-amber-800">
                    {tp('personExists')}{' '}
                    {exists.ids.map(id => (
                      <span key={id} className="mr-2">
                        <Link to={`/persons/${id}`} target="_blank" className="text-primary-700 hover:underline">{id}</Link>
                        <button type="button" disabled={busy} onClick={() => void act(proposalId, p, 'link', id)}
                          className="ml-1 rounded border border-amber-300 px-1.5 text-amber-900 hover:bg-amber-50">{tp('linkThis')}</button>
                      </span>
                    ))}
                  </div>
                )}
              </div>
              <div className="flex shrink-0 gap-1">
                <button type="button" disabled={busy} onClick={() => void act(proposalId, p, 'create')}
                  className="flex items-center gap-1 rounded bg-violet-700 px-2 py-1 text-xs text-white hover:bg-violet-800 disabled:opacity-50">
                  <UserPlus size={12} /> {tp('createPerson')}
                </button>
                <button type="button" disabled={busy || !token} onClick={() => setLinking({ proposalId, person: p })}
                  className="flex items-center gap-1 rounded border border-violet-300 px-2 py-1 text-xs text-violet-800 hover:bg-violet-50 disabled:opacity-50">
                  <Link2 size={12} /> {tp('linkExisting')}
                </button>
                <button type="button" disabled={busy} onClick={() => void act(proposalId, p, 'name')}
                  className="flex items-center gap-1 rounded border border-gray-300 px-2 py-1 text-xs text-gray-700 hover:bg-gray-100 disabled:opacity-50">
                  <Type size={12} /> {tp('keepName')}
                </button>
              </div>
            </li>
          );
        })}
      </ul>
      {linking && token && createPortal(
        <PersonAddPanel
          initialQuery={linking.person.name}
          token={token}
          lang={lang === 'en' ? 'en' : 'et'}
          context={{ work_id: workId }}
          onDone={res => { const l = linking; setLinking(null); void act(l.proposalId, l.person, 'link', res.id); }}
          onClose={() => setLinking(null)}
        />,
        document.body,
      )}
    </div>
  );
};

export default ProposedPersons;
