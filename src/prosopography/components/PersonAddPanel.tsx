/**
 * Isikupaneel (spekk §5-§6, PR 3 task 5): otsib Wikidata/GND/VIAF + VUTT-i
 * kandidaadid, grupeerib identiteedid ja lubab valida olemasoleva isiku või
 * luua uue ("Loo ja vali"). Kutsuja (EntityPicker, `/persons/new`) otsustab,
 * mida `onDone`-iga peale hakata.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { X, Loader2 } from 'lucide-react';
import { searchPersonSources } from '../panel/searchSources';
import { groupCandidates } from '../panel/candidateGroups';
import { chooseCardName } from '../panel/candidateNames';
import type { CandidateGroup, CandidateResult, SourceScheme } from '../panel/types';
import {
  createPersonChecked, fetchCandidates, getPerson, PersonConflictError,
  type CreatePersonBody, type SimilarPerson,
} from '../services/prosopographyService';

export interface PersonAddPanelProps {
  initialQuery: string;
  token: string;
  lang: 'et' | 'en';
  context?: { work_id: string; role?: string };
  /** Isik on valitud (olemasolev) või loodud. */
  onDone: (person: { id: string; label: string; created: boolean }) => void;
  onClose: () => void;
  /** Kui antud, avatakse selle viitega kandidaat kohe lahti (valija välise tulemuse klikk). */
  focusRef?: { scheme: 'wikidata' | 'gnd' | 'viaf'; id: string };
  /** Renderda tavalise lehe-plokina (nt `/persons/new`), mitte külgpaneelina — ilma taustakatte ja `fixed`-klassideta. */
  inline?: boolean;
}

const SOURCE_LABEL: Record<SourceScheme, string> = { wikidata: 'WD', gnd: 'GND', viaf: 'VIAF' };

function yearOf(date: string | null | undefined): number | null {
  if (!date) return null;
  const y = parseInt(date.slice(0, 4), 10);
  return y || null;
}

function norm(s: string): string {
  return s.trim().toLocaleLowerCase('et');
}

/** Grupi kaardinimi + valikuloend, korduskasutatav nii avamisel kui reamisel. */
function computeGroupName(group: CandidateGroup, query: string) {
  const names = group.members.flatMap(m => m.summary?.names ?? []);
  const firstOk = group.members.find(m => m.ok) ?? null;
  const fallback = firstOk?.summary?.label ?? '';
  const { chosen, matched, others } = chooseCardName(query, names, fallback);
  const optionsOrdered = [...matched, ...others.filter(o => !matched.includes(o))];
  return { chosen, matched, others, optionsOrdered, firstOk, fallback };
}

/** Sünni/surma aasta liikmete kaupa; kui kõik ok-liikmed nõustuvad, üks väärtus ilma allikata. */
function formatMemberDates(members: CandidateResult[], field: 'birth' | 'death'): string {
  const withYear = members
    .filter(m => m.ok && m.summary)
    .map(m => ({ scheme: m.scheme, year: yearOf(m.summary![field].date) }))
    .filter((x): x is { scheme: SourceScheme; year: number } => x.year != null);
  if (withYear.length === 0) return '';
  const uniqueYears = new Set(withYear.map(x => x.year));
  if (uniqueYears.size === 1) return String(withYear[0].year);
  return withYear.map(x => `${x.year} (${SOURCE_LABEL[x.scheme]})`).join(' · ');
}

// Eluaastad nagu PersonCard-is (*1592 †1654), kandidaadi kokkuvõtte põhjal.
const LifeYears: React.FC<{ birth: number | null; death: number | null }> = ({ birth, death }) => {
  if (birth == null && death == null) return null;
  return (
    <span>
      {birth != null && <><span className="text-primary-500">*</span>{birth}</>}
      {birth != null && death != null && '  '}
      {death != null && <><span className="text-primary-500">†</span>{death}</>}
    </span>
  );
};

interface ExistingEntry { id: string; label: string; birth: number | null; death: number | null }

const ExistingBlock: React.FC<{ entries: ExistingEntry[]; onSelect: (e: ExistingEntry) => void }> = ({ entries, onSelect }) => {
  const { t } = useTranslation(['prosopography']);
  if (entries.length === 0) return null;
  return (
    <section className="mb-4">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-1.5">{t('panel.existingTitle')}</h3>
      <ul className="space-y-1.5">
        {entries.map(e => (
          <li key={e.id} className="flex items-center justify-between gap-2 rounded border border-gray-200 bg-gray-50 px-2.5 py-1.5">
            <div className="min-w-0">
              <div className="text-sm font-medium text-gray-900 truncate">{e.label}</div>
              <p className="text-xs text-gray-500"><LifeYears birth={e.birth} death={e.death} /></p>
            </div>
            <button type="button" onClick={() => onSelect(e)}
              className="shrink-0 text-xs font-medium text-primary-700 hover:text-primary-900 hover:underline">
              {t('panel.selectExisting')}
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
};

const CandidateRow: React.FC<{
  group: CandidateGroup;
  query: string;
  state: { open: boolean; selectedName: string } | undefined;
  creating: boolean;
  /** Tõene, kui MÕNI rida parasjagu loob (mitte tingimata see) — M4: kõik loomisnupud keelatakse korraga. */
  createDisabled: boolean;
  onToggle: () => void;
  onSelectName: (name: string) => void;
  onCreate: () => void;
  onSelectExisting: () => void;
}> = ({ group, query, state, creating, createDisabled, onToggle, onSelectName, onCreate, onSelectExisting }) => {
  const { t } = useTranslation(['prosopography']);
  const { chosen, matched, optionsOrdered, firstOk, fallback } = useMemo(
    () => computeGroupName(group, query), [group, query],
  );

  if (group.existingPersonIds.length > 0) {
    return (
      <div data-testid="candidate-row" className="flex items-center justify-between gap-2 rounded border border-gray-200 px-2.5 py-1.5">
        <span className="text-sm text-gray-700 truncate">
          {fallback || chosen} — <em className="text-gray-400 not-italic">{t('panel.alreadyInVutt')}</em>
        </span>
        <button type="button" onClick={onSelectExisting}
          className="shrink-0 text-xs font-medium text-primary-700 hover:text-primary-900 hover:underline">
          {t('panel.selectExisting')}
        </button>
      </div>
    );
  }

  const open = state?.open ?? false;
  const selectedName = state?.selectedName ?? chosen;
  const birth = yearOf(firstOk?.summary?.birth.date);
  const death = yearOf(firstOk?.summary?.death.date);
  const showMatchNote = matched.length > 0 && matched[0] !== fallback;
  const places = [firstOk?.summary?.birth.place?.label, firstOk?.summary?.death.place?.label].filter(Boolean);

  return (
    <div data-testid="candidate-row" role="button" tabIndex={0} onClick={onToggle}
      onKeyDown={e => {
        // M2: klahv peab tulema realt endalt, mitte sisemiselt selectilt/nupult
        // (need bubble'ivad muidu üles ja avaks/sulgeks rea tahtmatult).
        if (e.target !== e.currentTarget) return;
        if (e.key === 'Enter') { onToggle(); }
        else if (e.key === ' ') { e.preventDefault(); onToggle(); }
      }}
      className="rounded border border-gray-200 cursor-pointer">
      <div className="w-full flex flex-col items-start gap-1 px-2.5 py-1.5 hover:bg-gray-50">
        <div className="w-full flex items-center gap-1.5">
          <span className="text-sm font-medium text-gray-900 truncate">{chosen}</span>
          <span className="text-xs text-gray-500"><LifeYears birth={birth} death={death} /></span>
        </div>
        <div className="flex items-center gap-1.5">
          {group.members.map(m => (
            m.ok && m.summary ? (
              <a key={m.scheme} href={m.summary.url} target="_blank" rel="noreferrer" onClick={e => e.stopPropagation()}
                className="inline-flex items-center px-1 py-0.5 rounded bg-primary-50 text-primary-700 border border-primary-200 text-[10px] font-semibold">
                {SOURCE_LABEL[m.scheme]}
              </a>
            ) : (
              <span key={m.scheme} className="inline-flex items-center px-1 py-0.5 rounded bg-gray-100 text-gray-400 border border-gray-200 text-[10px] font-semibold">
                {SOURCE_LABEL[m.scheme]}
              </span>
            )
          ))}
        </div>
        {showMatchNote && <p className="text-xs text-gray-400">{t('panel.matchedVariant', { name: matched[0] })}</p>}
      </div>

      {open && (
        <div onClick={e => e.stopPropagation()} className="border-t border-gray-100 px-2.5 py-2 space-y-2">
          {group.members.filter(m => !m.ok).map(m => (
            <p key={`${m.scheme}:${m.id}`} className="text-xs text-gray-400">
              {t('panel.sourceNoResponse', { source: SOURCE_LABEL[m.scheme] })}
            </p>
          ))}
          {formatMemberDates(group.members, 'birth') && (
            <p className="text-xs text-gray-600">{t('born')}: {formatMemberDates(group.members, 'birth')}</p>
          )}
          {formatMemberDates(group.members, 'death') && (
            <p className="text-xs text-gray-600">{t('died')}: {formatMemberDates(group.members, 'death')}</p>
          )}
          {places.length > 0 && <p className="text-xs text-gray-400">{places.join(' · ')}</p>}
          {(firstOk?.summary?.occupations.length ?? 0) > 0 && (
            <p className="text-xs text-gray-400">{firstOk!.summary!.occupations.slice(0, 6).map(o => o.label).join(', ')}</p>
          )}
          {firstOk?.summary?.description && <p className="text-xs text-gray-400 italic">{firstOk.summary.description}</p>}

          <div>
            <label className="block text-[11px] font-medium text-gray-500 mb-0.5">{t('panel.nameOnCard')}</label>
            <select value={selectedName} onChange={e => onSelectName(e.target.value)}
              className="w-full rounded border border-gray-300 px-2 py-1 text-sm">
              {optionsOrdered.map(n => <option key={n} value={n}>{n}</option>)}
            </select>
          </div>

          <button type="button" onClick={onCreate} disabled={createDisabled}
            className="w-full rounded bg-primary-600 text-white text-sm font-medium py-1.5 hover:bg-primary-700 disabled:opacity-50">
            {creating ? <Loader2 className="inline w-3.5 h-3.5 animate-spin" /> : t('panel.createAndSelect')}
          </button>
        </div>
      )}
    </div>
  );
};

const NoSourceBlock: React.FC<{
  name: string; note: string; context?: { work_id: string; role?: string }; creating: boolean;
  createDisabled: boolean;
  onNameChange: (v: string) => void; onNoteChange: (v: string) => void; onCreate: () => void;
}> = ({ name, note, context, creating, createDisabled, onNameChange, onNoteChange, onCreate }) => {
  const { t } = useTranslation(['prosopography']);
  // Vorm on vaikimisi kokku pandud — muidu oleks korraga kaks „Loo ja vali" nuppu
  // ekraanil (see + avatud kandidaadirida), mis segaks ka klaviatuuri/lugejaga navigeerimist.
  const [formOpen, setFormOpen] = useState(false);
  return (
    <section className="mt-4 border-t border-gray-200 pt-3">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-1">{t('panel.noSourceTitle')}</h3>
      <p className="text-xs text-gray-400 mb-2">{t('panel.noSourceHint')}</p>
      {!formOpen ? (
        <button type="button" onClick={() => setFormOpen(true)} className="text-xs font-medium text-primary-700 hover:text-primary-900 hover:underline">
          {t('panel.createWithoutSource')}
        </button>
      ) : (
        <>
          <input type="text" value={name} onChange={e => onNameChange(e.target.value)}
            className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm mb-2" />
          <label className="block text-[11px] font-medium text-gray-500 mb-0.5">{t('panel.note')}</label>
          <textarea value={note} onChange={e => onNoteChange(e.target.value)} rows={2}
            className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm mb-2" />
          {context && <p className="text-xs text-gray-400 mb-2">{t('panel.linkedToWork')}</p>}
          <button type="button" onClick={onCreate} disabled={createDisabled || !name.trim()}
            className="w-full rounded bg-primary-600 text-white text-sm font-medium py-1.5 hover:bg-primary-700 disabled:opacity-50">
            {creating ? <Loader2 className="inline w-3.5 h-3.5 animate-spin" /> : t('panel.createAndSelect')}
          </button>
        </>
      )}
    </section>
  );
};

const PersonAddPanel: React.FC<PersonAddPanelProps> = ({ initialQuery, token, lang, context, onDone, onClose, focusRef, inline }) => {
  const { t } = useTranslation(['prosopography', 'common']);
  const inputRef = useRef<HTMLInputElement>(null);
  const searchIdRef = useRef(0);
  const isFirstRun = useRef(true);
  const focusRefApplied = useRef(false);

  const [query, setQuery] = useState(initialQuery);
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<CandidateResult[]>([]);
  const [similarPersons, setSimilarPersons] = useState<SimilarPerson[]>([]);
  const [failedSources, setFailedSources] = useState<SourceScheme[]>([]);
  const [openState, setOpenState] = useState<Record<string, { open: boolean; selectedName: string }>>({});
  const [creatingKey, setCreatingKey] = useState<string | null>(null);
  const [conflictIds, setConflictIds] = useState<string[] | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [createError, setCreateError] = useState<string | null>(null);
  const [manualName, setManualName] = useState(initialQuery);
  const [manualNote, setManualNote] = useState('');
  const [candidatesError, setCandidatesError] = useState(false);

  // I4: Wikidata täistekstiotsing toob ka mitte-isikuid (asutused, kohad jms).
  // Grupp, mille ainus liige on selline mitte-inimene WD-kirje (ilma GND/VIAF
  // vasteta, mis oleks selle üle kinnitanud), ei kuulu isikupaneeli.
  const groups = useMemo(() => groupCandidates(results).filter(g => {
    const wd = g.members.find(m => m.scheme === 'wikidata');
    if (!wd?.ok || wd.summary?.is_human !== false) return true;
    return g.members.some(m => m.scheme !== 'wikidata');
  }), [results]);

  const runSearch = useCallback(async (q: string) => {
    const id = ++searchIdRef.current;
    if (!q.trim()) {
      setResults([]); setSimilarPersons([]); setFailedSources([]); setCandidatesError(false);
      return;
    }
    setLoading(true);
    setConflictIds(null);
    setCandidatesError(false);
    try {
      const { refs, failed } = await searchPersonSources(q, lang, focusRef);
      if (id !== searchIdRef.current) return;
      setFailedSources(failed);
      const { results: res, similar_persons } = await fetchCandidates(
        q, refs.map(r => ({ scheme: r.scheme, id: r.id })), token,
      );
      if (id !== searchIdRef.current) return;
      setResults(res);
      setSimilarPersons(similar_persons);
    } catch {
      if (id === searchIdRef.current) {
        setResults([]); setSimilarPersons([]); setCandidatesError(true);
      }
    } finally {
      if (id === searchIdRef.current) setLoading(false);
    }
  }, [lang, token, focusRef]);

  // Esmane otsing käivitub kohe (viide 0 ms), edasised otsinguvälja muudatused 400 ms debounce'iga.
  useEffect(() => {
    const delay = isFirstRun.current ? 0 : 400;
    isFirstRun.current = false;
    const timer = setTimeout(() => { runSearch(query); }, delay);
    return () => clearTimeout(timer);
  }, [query, runSearch]);

  useEffect(() => { inputRef.current?.focus(); }, []);

  useEffect(() => {
    // Tekstisisel paneelil (`/persons/new`) ei ole Esc-il sulgemist kuhugi tagasi
    // minna — `onClose` võib seal olla no-op, seega kuularit ei registreerita üldse.
    if (inline) return;
    // M4: loomine käib — Esc ei tohi paneeli kinni lüüa (päring on veel lennus).
    const onKeyDown = (e: KeyboardEvent) => { if (e.key === 'Escape' && !creatingKey) onClose(); };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [inline, onClose, creatingKey]);

  // focusRef: väljastpoolt viidatud kandidaat avatakse kohe, aga ainult ÜKS kord —
  // muidu avab efekt grupi uuesti iga `groups`-muutuse peale ka siis, kui kasutaja
  // on selle vahepeal ise sulgenud.
  useEffect(() => {
    if (!focusRef || focusRefApplied.current) return;
    const match = groups.find(g => g.ids[focusRef.scheme] === focusRef.id);
    if (!match) return;
    focusRefApplied.current = true;
    setOpenState(prev => {
      if (prev[match.key]?.open) return prev;
      const { chosen } = computeGroupName(match, query);
      return { ...prev, [match.key]: { open: true, selectedName: chosen } };
    });
  }, [groups, focusRef, query]);

  const existingEntries = useMemo<ExistingEntry[]>(() => {
    const map = new Map<string, ExistingEntry>();
    for (const sp of similarPersons) {
      map.set(sp.id, { id: sp.id, label: sp.label, birth: sp.birth_year, death: sp.death_year });
    }
    for (const g of groups) {
      for (const pid of g.existingPersonIds) {
        if (map.has(pid)) continue;
        const { fallback, firstOk } = computeGroupName(g, query);
        map.set(pid, {
          id: pid,
          label: fallback || pid,
          birth: yearOf(firstOk?.summary?.birth.date),
          death: yearOf(firstOk?.summary?.death.date),
        });
      }
    }
    return [...map.values()];
  }, [similarPersons, groups, query]);

  const submitCreate = useCallback(async (key: string, body: CreatePersonBody, fallbackLabel: string) => {
    setCreatingKey(key);
    setConflictIds(null);
    setCreateError(null);
    try {
      const person = await createPersonChecked(body, token);
      setNotice(t('panel.createdNotice'));
      onDone({ id: person.id, label: person.name?.label ?? fallbackLabel, created: true });
    } catch (err) {
      if (err instanceof PersonConflictError) {
        if (err.conflict === 'exists') {
          // I5: fallbackLabel on paneeli enda valik/otsingusõna, mitte tingimata
          // olemasoleva kaardi kanooniline nimi — proovime seda enne onDone-i.
          const existingId = err.existingPersonIds[0];
          let label = fallbackLabel;
          try {
            const person = await getPerson(existingId);
            label = person.name?.label ?? fallbackLabel;
          } catch {
            // Kanoonilise nime laadimine ebaõnnestus — jääme fallback-nimega, id ise on ikka õige.
          }
          onDone({ id: existingId, label, created: false });
        } else {
          setConflictIds(err.existingPersonIds);
        }
      } else {
        // Muu viga (võrk, 500, timeout, vigane vastus): jääme vormi juurde,
        // kasutaja saab uuesti proovida — andmeid ei kaotata, aga tõrge peab olema nähtav.
        setCreateError(t('panel.createFailed'));
      }
    } finally {
      setCreatingKey(null);
    }
  }, [token, onDone, t]);

  const toggleGroup = (group: CandidateGroup) => {
    setOpenState(prev => {
      const cur = prev[group.key];
      if (cur?.open) return { ...prev, [group.key]: { ...cur, open: false } };
      const { chosen } = computeGroupName(group, query);
      return { ...prev, [group.key]: { open: true, selectedName: cur?.selectedName ?? chosen } };
    });
  };

  const handleCreateFromGroup = (group: CandidateGroup) => {
    const { optionsOrdered, chosen } = computeGroupName(group, query);
    const selectedName = openState[group.key]?.selectedName ?? chosen;
    const normSel = norm(selectedName);
    const aliases = optionsOrdered.filter(n => norm(n) !== normSel).slice(0, 30);
    const identifiers = (Object.entries(group.ids) as [string, string | undefined][])
      .filter((e): e is [string, string] => e[1] != null)
      .map(([scheme, id]) => ({ scheme, id }));
    submitCreate(group.key, { name: selectedName, identifiers, aliases, context, created_via: 'picker' }, selectedName);
  };

  const handleSelectExistingFromGroup = (group: CandidateGroup) => {
    const { fallback, chosen } = computeGroupName(group, query);
    onDone({ id: group.existingPersonIds[0], label: fallback || chosen, created: false });
  };

  const handleCreateManual = () => {
    submitCreate('manual', {
      name: manualName, note: manualNote.trim() || undefined, context, created_via: 'picker',
    }, manualName);
  };

  // M4: loomine on lennus — sulgemine (tausta klõps, X, Esc) ei tohi paneeli kaotada.
  const handleClose = () => { if (!creatingKey) onClose(); };

  return (
    <>
      {!inline && <div className="fixed inset-0 bg-black/30 z-[1300]" onClick={handleClose} />}
      <div className={inline
        ? 'bg-white rounded-lg border border-gray-200 shadow-sm flex flex-col'
        : 'fixed inset-y-0 right-0 w-full sm:w-[28rem] z-[1300] bg-white shadow-2xl flex flex-col'}>
        <div className="flex items-center justify-between gap-2 border-b border-gray-200 px-4 py-3">
          <h2 className="text-base font-semibold text-gray-900">{t('panel.title')}</h2>
          {!inline && (
            <button type="button" onClick={handleClose} aria-label={t('common:buttons.close')} className="text-gray-400 hover:text-gray-600">
              <X size={18} />
            </button>
          )}
        </div>

        <div className="px-4 pt-3">
          <input ref={inputRef} type="text" value={query} onChange={e => setQuery(e.target.value)}
            placeholder={t('panel.searchPlaceholder')}
            className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm" />
          {loading && <p className="mt-1 text-xs text-gray-400">{t('panel.searching')}</p>}
          {failedSources.map(s => (
            <p key={s} className="mt-1 text-xs text-amber-600">{t('panel.sourceSearchFailed', { source: SOURCE_LABEL[s] })}</p>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-3">
          <ExistingBlock entries={existingEntries} onSelect={e => onDone({ id: e.id, label: e.label, created: false })} />

          <section>
            <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-1.5">{t('panel.sourcesTitle')}</h3>
            {/* I2: laadimistõrge ja "kedagi ei leitud" on kaks eri olekut — tõrke korral
                EI näidata noResults-teadet, mis jätaks mulje, et otsing lihtsalt käis läbi. */}
            {!loading && groups.length === 0 && (
              candidatesError
                ? <p role="alert" className="text-xs text-red-600">{t('panel.candidatesFailed')}</p>
                : <p className="text-xs text-gray-400">{t('panel.noResults')}</p>
            )}
            <ul className="space-y-1.5">
              {groups.map(g => (
                <li key={g.key}>
                  <CandidateRow
                    group={g}
                    query={query}
                    state={openState[g.key]}
                    creating={creatingKey === g.key}
                    createDisabled={creatingKey !== null}
                    onToggle={() => toggleGroup(g)}
                    onSelectName={name => setOpenState(prev => ({ ...prev, [g.key]: { open: true, selectedName: name } }))}
                    onCreate={() => handleCreateFromGroup(g)}
                    onSelectExisting={() => handleSelectExistingFromGroup(g)}
                  />
                </li>
              ))}
            </ul>
          </section>

          {conflictIds && (
            <div className="mt-3 rounded border border-amber-300 bg-amber-50 px-2.5 py-2 text-xs text-amber-800">
              <p>{t('panel.splitConflict')}</p>
              <p className="mt-1 flex gap-2">
                {conflictIds.map(id => (
                  <a key={id} href={`/persons/${id}`} target="_blank" rel="noreferrer" className="underline">{id}</a>
                ))}
              </p>
            </div>
          )}

          {notice && <p role="status" className="mt-3 text-xs text-green-700">{notice}</p>}
          {createError && <p role="alert" className="mt-3 text-xs text-red-600">{createError}</p>}

          <NoSourceBlock
            name={manualName}
            note={manualNote}
            context={context}
            creating={creatingKey === 'manual'}
            createDisabled={creatingKey !== null}
            onNameChange={setManualName}
            onNoteChange={setManualNote}
            onCreate={handleCreateManual}
          />
        </div>
      </div>
    </>
  );
};

export default PersonAddPanel;
