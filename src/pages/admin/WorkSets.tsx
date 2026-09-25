/**
 * Töökollektsioonide haldus (#354).
 *
 * Kogu on kureeritud teoste valik, mitte kollektsioon: teoste `collections`,
 * `is_public` ja `shareable` jäävad puutumata. Liikmesust ei indekseerita
 * Meilisearchi (ADR 0042) — liikmete arv tuleb serverilt kutsuja kohta.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ChevronLeft, Loader2, Plus, Users, Archive, RotateCcw, Globe, Lock, Trash2, ChevronDown, ChevronRight, X, Pencil } from 'lucide-react';
import Header from '../../components/Header';
import { useUser } from '../../contexts/UserContext';
import { useCollection } from '../../contexts/CollectionContext';
import { isAtLeast } from '../../utils/roleUtils';
import { loomiseTulem } from './workSetCreateOutcome';
import { getLangCode } from '../../utils/getLangCode';
import {
  WorkSetSummary, WorkSetMember, listWorkSets, createWorkSet, patchWorkSet, deleteWorkSet,
  getWorkSetWorkIds, getWorkSetMembers, removeWorks, invalidateWorkSetIds,
} from '../../services/workSetService';
import { useMeiliIndex } from '../../contexts/MeilisearchContext';
import { apiPost } from '../../services/apiClient';
import WorkSetAccessPanel from './WorkSetAccessPanel';
import { KnownUser } from './workSetAccessDraft';

type KogunNimi = { et: string; en: string };
const TYHI_NIMI: KogunNimi = { et: '', en: '' };

/** Server nõuab vähemalt ühte keelt; teine võib jääda tühjaks — kuvamine
 * langeb siis tagasi olemasolevale nimele. */
const nimiOnAntud = (n: KogunNimi) => !!(n.et.trim() || n.en.trim());
const puhastaNimi = (n: KogunNimi): KogunNimi => ({ et: n.et.trim(), en: n.en.trim() });

const NimeValjad: React.FC<{
  value: KogunNimi;
  onChange: (n: KogunNimi) => void;
  onEnter: () => void;
  labelEt: string;
  labelEn: string;
}> = ({ value, onChange, onEnter, labelEt, labelEn }) => (
  <>
    {(['et', 'en'] as const).map(keel => (
      <input
        key={keel}
        type="text"
        value={value[keel]}
        onChange={(e) => onChange({ ...value, [keel]: e.target.value })}
        onKeyDown={(e) => { if (e.key === 'Enter') onEnter(); }}
        placeholder={keel === 'et' ? labelEt : labelEn}
        aria-label={keel === 'et' ? labelEt : labelEn}
        className="flex-1 min-w-[12rem] px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
      />
    ))}
  </>
);

const WorkSets: React.FC = () => {
  const { t, i18n } = useTranslation(['admin', 'common']);
  const { user, authToken, isLoading: userLoading } = useUser();
  const { refreshWorkSets } = useCollection();
  const index = useMeiliIndex();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const lang = getLangCode(i18n.language);

  const [sets, setSets] = useState<WorkSetSummary[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  // Nimi on kakskeelne: ühe välja kopeerimine mõlemasse keelde jättis teise
  // keele vaatesse võõrkeelse nime, mida ei saanud hiljem parandada.
  const [newName, setNewName] = useState<KogunNimi>(TYHI_NIMI);
  // Olemasoleva kogu nime muutmine: korraga ainult üks rida.
  const [editNameId, setEditNameId] = useState<string | null>(null);
  const [editName, setEditName] = useState<KogunNimi>(TYHI_NIMI);
  // Avatud kogu liikmed. Laetakse nõudmisel: enamik haldustoiminguid ei vaja
  // nimekirja ja 1000 pealkirja laadimine iga kogu kohta oleks raiskamine.
  const [openId, setOpenId] = useState<string | null>(null);
  const [members, setMembers] = useState<WorkSetMember[]>([]);
  const [membersLoading, setMembersLoading] = useState(false);
  const [membersError, setMembersError] = useState<string | null>(null);
  // Kasutajate üldloend on ADMINI oma: haldur ei saa seda (spekk §3).
  // Laetakse korra, mitte iga paneeli avamisel.
  const [users, setUsers] = useState<KnownUser[]>([]);
  // Eraldi lipp: tühi loend „ei laadinud" ja tühi loend „ei ole kasutajaid"
  // annavad paneelis eri vastuse.
  const [usersKnown, setUsersKnown] = useState(false);
  const [accessOpenId, setAccessOpenId] = useState<string | null>(null);

  const isAdmin = isAtLeast(user?.role, 'admin');

  useEffect(() => {
    if (!userLoading && !user) navigate('/');
  }, [user, userLoading, navigate]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await listWorkSets(showArchived);
      setSets(data);
      setError(null);
      // Liikmete arv on kutsujapõhine: sama kogu näitab eri inimestele eri arvu,
      // sest ligipääsmatud teosed ei ole loendis.
      const paarid = await Promise.all(data.map(async ws => {
        try { return [ws.id, (await getWorkSetWorkIds(ws.id)).length] as const; }
        catch { return [ws.id, -1] as const; }
      }));
      setCounts(Object.fromEntries(paarid));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [showArchived]);

  useEffect(() => { load(); }, [load]);

  // ?set=<id> on ÜHESUUNALINE sisenemispunkt hubist: avame selle kogu paneeli,
  // aga kui kasutaja paneeli käsitsi sulgeb, URL-i tagasi EI kirjutata — see
  // oleks teine peegel (ADR 0038). Ainult `set` väärtuse muutumisel, muidu ei
  // saaks paneeli üldse sulgeda.
  const setParam = searchParams.get('set');
  useEffect(() => {
    if (!setParam) return;
    setAccessOpenId(setParam);
    // Arhiveeritud kogu ei ole vaikimisi loendis — deep-link toob ta nähtavale.
    setShowArchived(true);
  }, [setParam]);

  useEffect(() => {
    if (!isAdmin) return;
    apiPost<{ status: string; users?: KnownUser[] }>('/admin/users', {}, { token: authToken })
      .then(d => { setUsers(d.users || []); setUsersKnown(true); })
      // Kasutajate loendi puudumine EI tohi paneeli blokeerida: olemasolevad
      // kirjed jäävad nähtavaks, ainult lisamine jääb tegemata.
      .catch(() => { setUsers([]); setUsersKnown(false); });
  }, [isAdmin, authToken]);

  const avaLiikmed = async (setId: string) => {
    if (openId === setId) { setOpenId(null); return; }
    setOpenId(setId);
    setMembers([]);
    setMembersError(null);
    if (!index) return;
    setMembersLoading(true);
    try {
      const ids = await getWorkSetWorkIds(setId);
      setMembers(await getWorkSetMembers(index, ids));
    } catch {
      setMembersError(t('workSets.loadMembersFailed'));
    } finally {
      setMembersLoading(false);
    }
  };

  /**
   * Liikme eemaldamine. `revision` jäetakse saatmata: eemaldamine on delta
   * („eemalda see"), mitte täisasendus, seega vananenud vaade ei saa kellegi
   * paralleelset lisandust maha kirjutada.
   */
  const eemalda = async (setId: string, workId: string) => {
    setBusyId(setId);
    try {
      await removeWorks(setId, [workId]);
      setMembers(prev => prev.filter(m => m.work_id !== workId));
      invalidateWorkSetIds(setId);
      setCounts(prev => ({ ...prev, [setId]: Math.max(0, (prev[setId] ?? 1) - 1) }));
      setError(null);
    } catch {
      setError(t('workSets.saveFailed'));
    } finally {
      setBusyId(null);
    }
  };

  const muuda = async (ws: WorkSetSummary, changes: Record<string, unknown>): Promise<boolean> => {
    setBusyId(ws.id);
    try {
      await patchWorkSet(ws.id, changes, ws.revision);
      await load();
      await refreshWorkSets();
      setError(null);
      return true;
    } catch (e) {
      const status = (e as { status?: number }).status;
      setError(status === 409 ? t('workSets.conflict') : t('workSets.saveFailed'));
      return false;
    } finally {
      setBusyId(null);
    }
  };

  const kustuta = async (ws: WorkSetSummary) => {
    setBusyId(ws.id);
    try {
      await deleteWorkSet(ws.id);
      await load();
      await refreshWorkSets();
      setError(null);
    } catch (e) {
      const status = (e as { status?: number }).status;
      setError(status === 409 ? t('workSets.publishedCannotDelete') : t('workSets.saveFailed'));
    } finally {
      setBusyId(null);
    }
  };

  const alustaNimeMuutmist = (ws: WorkSetSummary) => {
    setEditNameId(ws.id);
    setEditName({ et: ws.name.et || '', en: ws.name.en || '' });
  };

  const salvestaNimi = async (ws: WorkSetSummary) => {
    if (!nimiOnAntud(editName)) return;
    // Ebaõnnestumisel jääb vorm lahti, et sisestus ei kaoks.
    if (await muuda(ws, { name: puhastaNimi(editName) })) setEditNameId(null);
  };

  const loo = async () => {
    if (!nimiOnAntud(newName)) return;
    setBusyId('new');
    try {
      const loodud = await createWorkSet(puhastaNimi(newName));
      setNewName(TYHI_NIMI);
      // Spekk §2: „Kogu loomise järel on sama paneel kohe kättesaadav."
      setAccessOpenId(loodud.id);
      await load();
      await refreshWorkSets();
      setError(null);
    } catch (e) {
      // Katkenud vastus EI OLE ebaõnnestunud töö: server viib kirjutuse lõpuni
      // ka siis, kui klient on juba läinud (`run_in_threadpool` lõime ei
      // tühistata) — täpselt nii tekkis „ebaõnnestus", kuigi kogu oli loodud.
      // Laeme loendi ja ütleme ainult seda, mida tegelikult teame.
      const tulem = loomiseTulem(e);
      if (tulem === 'kinnitamata') setNewName(TYHI_NIMI);  // kordusklikk = duplikaat
      await load();
      await refreshWorkSets();
      // `load()` nullib vea õnnestumisel — teade käib seega PEALE, mitte enne.
      setError(tulem === 'kinnitamata'
        ? t('workSets.createUnconfirmed')
        : t('workSets.saveFailed'));
    } finally {
      setBusyId(null);
    }
  };

  if (userLoading || !user) return null;

  return (
    <div className="min-h-screen bg-gray-50">
      <Header showSearchButton={false} pageTitle={t('workSets.title')} />
      <div className="max-w-4xl mx-auto px-4 py-8">
        <Link to="/admin" className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700 mb-4">
          <ChevronLeft size={16} /> Admin
        </Link>

        <h1 className="text-2xl font-bold text-gray-800 mb-4 flex items-center gap-2">
          <Users size={22} className="text-primary-600" />
          {t('workSets.title')}
        </h1>

        {error && (
          <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded text-sm text-red-700">{error}</div>
        )}

        {isAdmin && (
          <div className="mb-6 flex gap-2 flex-wrap">
            <NimeValjad
              value={newName}
              onChange={setNewName}
              onEnter={loo}
              labelEt={t('workSets.nameEt')}
              labelEn={t('workSets.nameEn')}
            />
            <button
              onClick={loo}
              disabled={!nimiOnAntud(newName) || busyId === 'new'}
              className="inline-flex items-center gap-1 px-3 py-2 bg-primary-600 text-white rounded-lg text-sm font-medium disabled:opacity-50"
            >
              {busyId === 'new' ? <Loader2 size={16} className="animate-spin" /> : <Plus size={16} />}
              {t('workSets.create')}
            </button>
          </div>
        )}

        <label className="flex items-center gap-2 text-sm text-gray-600 mb-3">
          <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} />
          {t('workSets.showArchived')}
        </label>

        {loading ? (
          <div className="flex justify-center py-12"><Loader2 className="animate-spin text-gray-400" /></div>
        ) : sets.length === 0 ? (
          <p className="text-gray-500 text-center py-12">{t('workSets.empty')}</p>
        ) : (
          <div className="space-y-2">
            {sets.map(ws => {
              const arhiveeritud = ws.status === 'archived';
              const arv = counts[ws.id];
              return (
                <div key={ws.id} className={`bg-white border rounded-lg p-4 ${arhiveeritud ? 'border-gray-200 opacity-70' : 'border-gray-200'}`}>
                  <div className="flex items-start justify-between gap-3 flex-wrap">
                    <div className="min-w-0">
                      {editNameId === ws.id ? (
                        <div className="flex gap-2 flex-wrap items-center">
                          <NimeValjad
                            value={editName}
                            onChange={setEditName}
                            onEnter={() => salvestaNimi(ws)}
                            labelEt={t('workSets.nameEt')}
                            labelEn={t('workSets.nameEn')}
                          />
                          <button
                            onClick={() => salvestaNimi(ws)}
                            disabled={!nimiOnAntud(editName) || busyId === ws.id}
                            className="text-xs px-2 py-1 bg-primary-600 text-white rounded disabled:opacity-50"
                          >
                            {t('workSets.accessPanel.save')}
                          </button>
                          <button
                            onClick={() => setEditNameId(null)}
                            className="text-xs px-2 py-1 border border-gray-300 rounded hover:bg-gray-50"
                          >
                            {t('workSets.accessPanel.cancel')}
                          </button>
                        </div>
                      ) : (
                      <div className="font-medium text-gray-800 flex items-center gap-2">
                        {ws.name[lang] || ws.name.et || ws.name.en || ws.id}
                        {ws.can_manage && (
                          <button
                            onClick={() => alustaNimeMuutmist(ws)}
                            className="text-gray-400 hover:text-gray-700"
                            aria-label={t('workSets.rename')}
                            title={t('workSets.rename')}
                          >
                            <Pencil size={13} />
                          </button>
                        )}
                        {ws.visibility === 'public'
                          ? <Globe size={14} className="text-emerald-600" aria-label={t('workSets.visibilityPublic')} />
                          : <Lock size={14} className="text-gray-400" aria-label={t('workSets.visibilityMembers')} />}
                        {arhiveeritud && (
                          <span className="text-xs bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded">
                            {t('workSets.statusArchived')}
                          </span>
                        )}
                      </div>
                      )}
                      <div className="text-xs text-gray-500 mt-1 flex items-center gap-2">
                        {/* −1 = loendi päring ebaõnnestus. Null EI OLE õige vastus:
                            „0 liiget" ja „ei saanud teada" on eri asjad. */}
                        <button
                          onClick={() => avaLiikmed(ws.id)}
                          className="inline-flex items-center gap-1 hover:text-gray-800"
                        >
                          {openId === ws.id ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                          {t('workSets.members')}: {arv === -1 ? '—' : arv ?? '…'}
                        </button>
                        {ws.access && (
                          <button
                            onClick={() => setAccessOpenId(accessOpenId === ws.id ? null : ws.id)}
                            className="inline-flex items-center gap-1 hover:text-gray-800"
                          >
                            {accessOpenId === ws.id ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                            {t('workSets.access')}: {Object.keys(ws.access).length}
                          </button>
                        )}
                      </div>
                    </div>

                    {ws.can_manage && (
                      <div className="flex items-center gap-2 flex-wrap">
                        <button
                          onClick={() => muuda(ws, { status: arhiveeritud ? 'active' : 'archived' })}
                          disabled={busyId === ws.id}
                          className="inline-flex items-center gap-1 text-xs px-2 py-1 border border-gray-300 rounded hover:bg-gray-50 disabled:opacity-50"
                        >
                          {arhiveeritud ? <RotateCcw size={13} /> : <Archive size={13} />}
                          {arhiveeritud ? t('workSets.restore') : t('workSets.archive')}
                        </button>
                        {isAdmin && (
                          <button
                            onClick={() => muuda(ws, { visibility: ws.visibility === 'public' ? 'members' : 'public' })}
                            disabled={busyId === ws.id}
                            className="inline-flex items-center gap-1 text-xs px-2 py-1 border border-gray-300 rounded hover:bg-gray-50 disabled:opacity-50"
                          >
                            {ws.visibility === 'public' ? <Lock size={13} /> : <Globe size={13} />}
                            {ws.visibility === 'public' ? t('workSets.unpublish') : t('workSets.publish')}
                          </button>
                        )}
                        {isAdmin && !ws.ever_published && (
                          <button
                            onClick={() => kustuta(ws)}
                            disabled={busyId === ws.id}
                            className="inline-flex items-center gap-1 text-xs px-2 py-1 border border-rose-200 text-rose-700 rounded hover:bg-rose-50 disabled:opacity-50"
                          >
                            <Trash2 size={13} /> {t('workSets.delete')}
                          </button>
                        )}
                      </div>
                    )}
                  </div>

                  {accessOpenId === ws.id && (
                    <WorkSetAccessPanel
                      key={ws.id}
                      ws={ws}
                      users={users}
                      usersKnown={usersKnown}
                      actor={{ username: user?.username || '', role: user?.role || 'contributor' }}
                      canEdit={isAdmin && !!ws.can_manage}
                      onSaved={(uus) => {
                        // Uus kaart tuleb serverilt: kirjuta ainult see rida üle.
                        // `load()` sulgeks paneeli ja kaotaks mustandi.
                        setSets(prev => prev.map(x => (x.id === uus.id ? uus : x)));
                      }}
                    />
                  )}

                  {openId === ws.id && (
                    <div className="mt-3 border-t border-gray-100 pt-3">
                      {membersLoading ? (
                        <Loader2 size={16} className="animate-spin text-gray-400" />
                      ) : membersError ? (
                        <p className="text-sm text-red-600">{membersError}</p>
                      ) : members.length === 0 ? (
                        <p className="text-sm text-gray-500">{t('workSets.noMembers')}</p>
                      ) : (
                        <ul className="space-y-1">
                          {members.map(m => (
                            <li key={m.work_id} className="flex items-center gap-2 text-sm">
                              <Link
                                to={`/work/${m.work_id}`}
                                className="flex-1 truncate text-gray-700 hover:text-primary-700 hover:underline"
                              >
                                {m.title}
                                {m.year_display && <span className="text-gray-400"> · {m.year_display}</span>}
                              </Link>
                              {ws.can_manage && (
                                <button
                                  onClick={() => eemalda(ws.id, m.work_id)}
                                  disabled={busyId === ws.id}
                                  title={t('workSets.removeMember')}
                                  className="text-gray-400 hover:text-rose-600 disabled:opacity-50 shrink-0"
                                >
                                  <X size={14} />
                                </button>
                              )}
                            </li>
                          ))}
                        </ul>
                      )}
                      {/* Kutsuja näeb ainult talle nähtavaid liikmeid — peidetud
                          liikmete OLEMASOLU on info, nende arv mitte. */}
                      {arv !== -1 && arv !== undefined && members.length < arv && (
                        <p className="text-xs text-gray-400 mt-2">
                          {t('workSets.hiddenMembers', { count: arv - members.length })}
                        </p>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};

export default WorkSets;
