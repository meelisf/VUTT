/**
 * Kasutaja detailvaade (#318, spekk §1).
 *
 * Konto toimingud ja KOLM õiguste telge ühes kohas. Kollektsiooniõigused
 * (lugemisõigus + kirjutamisulatus) salvestuvad ÜHE delta-paketina: üks
 * kirjutus `users.json`-i ja üks sessioonide invalideerimine inimese kohta.
 * Töökollektsioonid on eraldi failid oma `revision`-lukuga — need salvestuvad
 * kogu kaupa ja osaline edu on tavaline tulemus (spekk §5).
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ChevronLeft, KeyRound, Loader2, Trash2 } from 'lucide-react';
import Header from '../../components/Header';
import { useUser } from '../../contexts/UserContext';
import { useCollection } from '../../contexts/CollectionContext';
import { apiPost } from '../../services/apiClient';
import { applyCollectionRights } from '../../services/collectionRightsService';
import { listWorkSets, setWorkSetAccess, WorkSetSummary } from '../../services/workSetService';
import { assignableRoles, canManageUser, isAtLeast } from '../../utils/roleUtils';
import { getLangCode } from '../../utils/getLangCode';
import { formatDateTime } from '../../utils/formatDateTime';
import ResetPasswordResult, { ResetResult } from './ResetPasswordResult';
import { accessChanges, SetRole } from './workSetAccess';
import { saveAccessChanges } from './userWorkSetSave';
import {
  addableAllowed, addableEdit, CollectionInfo, userRightsDelta, userRightsRows,
  UserRightsState,
} from './userRightsDraft';

interface AdminUser {
  username: string;
  name: string;
  email: string;
  role: string;
  created_at: string | null;
  allowed_collections?: string[];
  edit_collections?: string[];
}

const klooni = (s: UserRightsState): UserRightsState =>
  ({ allowed: new Set(s.allowed), edit: new Set(s.edit) });

const UserDetail: React.FC = () => {
  const { t, i18n } = useTranslation(['admin', 'common']);
  const lang = getLangCode(i18n.language);
  const { username } = useParams<{ username: string }>();
  const { user, authToken, isLoading: userLoading } = useUser();
  const { collections } = useCollection();
  const navigate = useNavigate();

  const [target, setTarget] = useState<AdminUser | null>(null);
  const [laadin, setLaadin] = useState(true);
  const [viga, setViga] = useState<string | null>(null);
  const [laetud, setLaetud] = useState<UserRightsState | null>(null);
  const [mustand, setMustand] = useState<UserRightsState | null>(null);
  const [salvestan, setSalvestan] = useState(false);
  const [workSets, setWorkSets] = useState<WorkSetSummary[]>([]);
  const [wsMustand, setWsMustand] = useState<Record<string, SetRole | null>>({});
  const [wsSalvestan, setWsSalvestan] = useState(false);
  const [wsTulemus, setWsTulemus] = useState<{ saved: string[]; failed: string[] } | null>(null);
  const [resetResult, setResetResult] = useState<ResetResult | null>(null);
  const [kustutaKinnitus, setKustutaKinnitus] = useState(false);

  useEffect(() => {
    if (!userLoading && (!user || !isAtLeast(user.role, 'admin'))) navigate('/');
  }, [user, userLoading, navigate]);

  const wsNimi = useCallback(
    (ws: WorkSetSummary) => ws.name[lang] || ws.name.et || ws.name.en || ws.id, [lang]);

  const kogud = useMemo<Record<string, CollectionInfo>>(() => Object.fromEntries(
    Object.entries(collections).map(([id, c]) => [id, {
      id,
      name: c.name?.[lang] || c.name?.et || id,
      // `visibility` puudumine tähendab avalikku kogu — sama mis serveris
      // (`kogu.get("visibility") != "restricted"`).
      visibility: c.visibility === 'restricted' ? 'restricted' : 'public',
      isVirtual: c.type === 'virtual_group',
    }])), [collections, lang]);

  const lae = useCallback(async () => {
    if (!authToken || !username) return;
    setLaadin(true);
    setViga(null);
    try {
      const d = await apiPost<{ status: string; users?: AdminUser[] }>(
        '/admin/users', {}, { token: authToken });
      const leitud = (d.users || []).find(u => u.username === username) || null;
      setTarget(leitud);
      if (leitud) {
        const olek: UserRightsState = {
          allowed: new Set(leitud.allowed_collections || []),
          edit: new Set(leitud.edit_collections || []),
        };
        setLaetud(olek);
        setMustand(klooni(olek));
      }
      // Arhiveeritud kaasa: kasutajal võib olla õigus arhiivis kogule ja
      // selle vaikne peitmine teeks õiguse eemaldamise võimatuks.
      const ws = await listWorkSets(true);
      setWorkSets(ws);
      setWsMustand(Object.fromEntries(
        ws.map(s => [s.id, ((s.access || {})[username] as SetRole) ?? null])));
    } catch {
      // Laadimisviga EI tohi muutuda tühjaks õiguste kaardiks: tühja mustandi
      // salvestamine võtaks kõik õigused ära.
      setLaetud(null);
      setMustand(null);
      setViga(t('users.detail.loadFailed'));
    } finally {
      setLaadin(false);
    }
  }, [authToken, username, t]);

  useEffect(() => { lae(); }, [lae]);

  const delta = useMemo(
    () => (laetud && mustand && target ? userRightsDelta(laetud, mustand, target.username) : []),
    [laetud, mustand, target]);

  const read = useMemo(
    () => (mustand && target ? userRightsRows(mustand, kogud, target.role) : []),
    [mustand, kogud, target]);

  const lyliti = (id: string, field: 'allowed' | 'edit', peal: boolean) => {
    setMustand(prev => {
      if (!prev) return prev;
      const next = klooni(prev);
      if (peal) next[field].add(id); else next[field].delete(id);
      return next;
    });
  };

  const salvestaOigused = async () => {
    if (!mustand || !target || delta.length === 0) return;
    setSalvestan(true);
    setViga(null);
    try {
      const tulemus = await applyCollectionRights(delta);
      const kinnitatud = tulemus.users?.[target.username];
      // Kinnitatud olek tuleb SERVERILT, mitte optimistlikust oletusest.
      const uus: UserRightsState = kinnitatud
        ? { allowed: new Set(kinnitatud.allowed_collections),
            edit: new Set(kinnitatud.edit_collections) }
        : klooni(mustand);
      setLaetud(klooni(uus));
      setMustand(uus);
    } catch (e) {
      setViga((e as { message?: string }).message || t('users.detail.saveFailed'));
    } finally {
      setSalvestan(false);
    }
  };

  const salvestaKogud = async () => {
    if (!target) return;
    const muudatused = accessChanges(workSets, target.username, wsMustand);
    if (muudatused.length === 0) return;
    setWsSalvestan(true);
    setWsTulemus(null);
    const nimed = Object.fromEntries(workSets.map(ws => [ws.id, wsNimi(ws)]));
    try {
      // saveAccessChanges ei viska: iga kogu viga kogutakse `failed`-i.
      const tulemus = await saveAccessChanges(
        muudatused, c => setWorkSetAccess(c.setId, c.access, c.revision));
      // Uus `revision` ja teiste vahepealsed muudatused tulevad serverilt:
      // mustand ehitatakse ALATI uuesti laetud kaardist (täieliku kaardi leping).
      const ws = await listWorkSets(true);
      setWorkSets(ws);
      setWsMustand(Object.fromEntries(
        ws.map(s => [s.id, ((s.access || {})[target.username] as SetRole) ?? null])));
      setWsTulemus({
        saved: tulemus.saved.map(id => nimed[id] || id),
        failed: tulemus.failed.map(f => nimed[f.setId] || f.setId),
      });
    } catch {
      // Nimekirja uuesti laadimine kukkus — osalist edu ei näidata tõena.
      setViga(t('users.detail.loadFailed'));
    } finally {
      setWsSalvestan(false);
    }
  };

  const muudaRolli = async (uusRoll: string) => {
    if (!target) return;
    setViga(null);
    try {
      await apiPost('/admin/users/update-role',
        { username: target.username, new_role: uusRoll }, { token: authToken });
      // Roll muudab õiguste ALUSEID (toimetaja ulatus tuleb rollist), seega
      // laadime terve vaate uuesti, mitte ei paika ainult rollivälja.
      await lae();
    } catch (e) {
      setViga((e as { message?: string }).message || t('users.roleChangeError'));
    }
  };

  const taastaParool = async () => {
    if (!target) return;
    setViga(null);
    setResetResult(null);
    try {
      const d = await apiPost<{ status: string; reset_url?: string; username?: string;
        name?: string; mail_sent?: boolean; mail_error?: string | null; message?: string }>(
        '/admin/users/reset-password', { username: target.username }, { token: authToken });
      if (d.status === 'success' && d.reset_url) {
        setResetResult({
          username: d.username || target.username,
          name: d.name || target.name,
          reset_url: d.reset_url,
          mail_sent: d.mail_sent,
          mail_error: d.mail_error,
        });
      } else {
        setViga(d.message || t('users.resetError'));
      }
    } catch (e) {
      setViga((e as { message?: string }).message || t('users.resetError'));
    }
  };

  const kustuta = async () => {
    if (!target) return;
    setKustutaKinnitus(false);
    setViga(null);
    try {
      await apiPost('/admin/users/delete', { username: target.username }, { token: authToken });
      // Kustutatud kasutaja detaili ei ole enam olemas — mine loendisse tagasi,
      // muidu jääks ekraanile kirje, mida serveris ei ole.
      navigate('/admin/users');
    } catch (e) {
      setViga((e as { message?: string }).message || t('users.deleteError'));
    }
  };

  if (userLoading || !user) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-primary-600" />
      </div>
    );
  }

  // Peitmine ei ole autoriseerimine — server kontrollib rolli ise.
  if (!isAtLeast(user.role, 'admin')) return null;

  const voibHallata = target ? canManageUser(user.role, target.role) : false;
  const onIse = target?.username === user.username;
  const voibKustutada = voibHallata && !onIse;
  const voibParooliTaastada = onIse || voibHallata;
  const wsMuudatusi = target ? accessChanges(workSets, target.username, wsMustand).length > 0 : false;

  const alusSilt = (b: string): string | null => {
    if (b === 'role_based') return t('users.detail.basisRoleBased');
    if (b === 'inert') return t('users.detail.basisInert');
    return null;
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <Header showSearchButton={false} pageTitle={target?.name || username || ''} />
      <div className="max-w-5xl mx-auto px-4 py-8">
        <Link to="/admin/users" className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700 mb-6">
          <ChevronLeft size={16} />
          {t('users.detail.back')}
        </Link>

        {viga && (
          <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-lg text-red-700">
            {viga}
            {!laetud && (
              <button type="button" onClick={lae} className="ml-2 underline">
                {t('collections.accessPanel.retry')}
              </button>
            )}
          </div>
        )}

        {resetResult && (
          <ResetPasswordResult result={resetResult} onClose={() => setResetResult(null)} />
        )}

        {laadin ? (
          <div className="flex justify-center py-8">
            <Loader2 className="w-6 h-6 animate-spin text-primary-600" />
          </div>
        ) : !target ? (
          <div className="bg-white rounded-lg border border-gray-200 p-8 text-center text-gray-500">
            {t('users.detail.notFound')}
          </div>
        ) : (
          <div className="space-y-4">
            {/* Konto */}
            <section className="bg-white rounded-lg border border-gray-200 p-4">
              <h2 className="text-lg font-semibold text-gray-800 mb-3">{t('users.detail.account')}</h2>
              <dl className="space-y-2 text-sm">
                <div className="flex gap-2">
                  <dt className="w-32 flex-shrink-0 text-gray-500">{t('users.name')}</dt>
                  <dd className="text-gray-900">{target.name}</dd>
                </div>
                <div className="flex gap-2">
                  <dt className="w-32 flex-shrink-0 text-gray-500">{t('users.username')}</dt>
                  <dd className="font-mono text-gray-900">{target.username}</dd>
                </div>
                <div className="flex gap-2">
                  <dt className="w-32 flex-shrink-0 text-gray-500">{t('users.email')}</dt>
                  <dd className="text-gray-900">{target.email}</dd>
                </div>
                <div className="flex gap-2">
                  <dt className="w-32 flex-shrink-0 text-gray-500">{t('users.created')}</dt>
                  <dd className="text-gray-900">
                    {target.created_at ? formatDateTime(target.created_at) : '-'}
                  </dd>
                </div>
                <div className="flex items-center gap-2">
                  <dt className="w-32 flex-shrink-0 text-gray-500">{t('users.role')}</dt>
                  <dd>
                    {!voibHallata || onIse ? (
                      <span className="inline-flex items-center gap-1 px-2 py-1 bg-gray-100 text-gray-600 rounded text-xs">
                        {t(`common:roles.${target.role}`)}
                      </span>
                    ) : (
                      <select
                        value={target.role}
                        onChange={(e) => muudaRolli(e.target.value)}
                        className="text-sm border border-gray-300 rounded px-2 py-1 focus:outline-none focus:ring-2 focus:ring-primary-500"
                      >
                        {assignableRoles(user.role).map((r) => (
                          <option key={r} value={r}>{t(`common:roles.${r}`)}</option>
                        ))}
                      </select>
                    )}
                  </dd>
                </div>
              </dl>

              <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-gray-100 pt-3">
                {voibParooliTaastada && (
                  <button
                    type="button"
                    onClick={taastaParool}
                    className="inline-flex items-center gap-1 rounded border border-gray-300 px-3 py-1.5 text-sm hover:bg-gray-50"
                  >
                    <KeyRound size={14} /> {t('users.resetPassword')}
                  </button>
                )}
                {voibKustutada && !kustutaKinnitus && (
                  <button
                    type="button"
                    onClick={() => setKustutaKinnitus(true)}
                    className="inline-flex items-center gap-1 rounded border border-red-300 px-3 py-1.5 text-sm text-red-700 hover:bg-red-50"
                  >
                    <Trash2 size={14} /> {t('users.delete')}
                  </button>
                )}
                {voibKustutada && kustutaKinnitus && (
                  <span className="inline-flex items-center gap-2 text-sm">
                    <span className="text-red-600">{t('users.confirmDelete')}</span>
                    <button
                      type="button"
                      onClick={kustuta}
                      className="rounded bg-red-600 px-3 py-1.5 text-white hover:bg-red-700"
                    >
                      {t('users.yes')}
                    </button>
                    <button
                      type="button"
                      onClick={() => setKustutaKinnitus(false)}
                      className="rounded bg-gray-200 px-3 py-1.5 text-gray-700 hover:bg-gray-300"
                    >
                      {t('users.no')}
                    </button>
                  </span>
                )}
              </div>
            </section>

            {/* Kollektsiooniõigused (kaks telge, üks delta) */}
            <section className="bg-white rounded-lg border border-gray-200 p-4">
              <h2 className="text-lg font-semibold text-gray-800">{t('users.detail.rightsTitle')}</h2>
              <p className="mt-1 text-xs text-gray-500">{t('users.detail.rightsHint')}</p>

              {!laetud || !mustand ? (
                // Laadimisviga ei tohi näha välja nagu „õigusi ei ole": tühi
                // nimekiri ja tühi mustand on eristamatud ning tühja mustandi
                // salvestamine võtaks kõik õigused ära. Retry on ülal veateates.
                <p className="mt-3 rounded border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                  {t('users.detail.loadFailed')}
                </p>
              ) : (
                <>
              <ul className="mt-3 divide-y divide-gray-200">
                {read.length === 0 && (
                  <li className="py-2 text-sm text-gray-500">{t('users.detail.noRights')}</li>
                )}
                {read.map(rida => {
                  const kogu = kogud[rida.collectionId];
                  // Lisada tohib ainult olemasolevale kogule ja ainult siis, kui
                  // see on lubatud: piiratud kogule lugemisõigus, mittevirtuaalsele
                  // kirjutamisulatus (editor+ saab ulatuse rollist).
                  const allowedLubatud = rida.allowed
                    || (rida.exists && kogu?.visibility === 'restricted');
                  const editLubatud = rida.edit
                    || (rida.exists && !kogu?.isVirtual && !isAtLeast(target.role, 'editor'));
                  // Ulatus ilma lugemisõiguseta PIIRATUD kogul ei ava teoseid —
                  // seda ei parandata vaikselt (ADR 0031), vaid pakutakse eraldi.
                  const ulatusIlmaLugemiseta = rida.edit && !rida.allowed
                    && rida.exists && kogu?.visibility === 'restricted'
                    && rida.editBasis === 'assigned';
                  return (
                    <li key={rida.collectionId} className="py-2">
                      <div className="flex flex-wrap items-center gap-3">
                        <span className="text-sm text-gray-800">
                          {rida.exists
                            ? rida.name
                            : t('users.detail.deletedCollection', { id: rida.collectionId })}
                        </span>

                        <label className="flex items-center gap-1 text-sm text-gray-700">
                          <input
                            type="checkbox"
                            checked={rida.allowed}
                            disabled={salvestan || !voibHallata || !allowedLubatud}
                            onChange={e => lyliti(rida.collectionId, 'allowed', e.target.checked)}
                          />
                          {t('users.detail.readRight')}
                          {alusSilt(rida.allowedBasis) && (
                            <span className="rounded bg-gray-200 px-1.5 py-0.5 text-xs text-gray-700">
                              {alusSilt(rida.allowedBasis)}
                            </span>
                          )}
                        </label>

                        <label className="flex items-center gap-1 text-sm text-gray-700">
                          <input
                            type="checkbox"
                            checked={rida.edit}
                            disabled={salvestan || !voibHallata || !editLubatud}
                            onChange={e => lyliti(rida.collectionId, 'edit', e.target.checked)}
                          />
                          {t('users.detail.writeScope')}
                          {alusSilt(rida.editBasis) && (
                            <span className="rounded bg-gray-200 px-1.5 py-0.5 text-xs text-gray-700">
                              {alusSilt(rida.editBasis)}
                            </span>
                          )}
                        </label>
                      </div>

                      {rida.allowedBasis === 'inert' && rida.exists
                        && kogu?.visibility === 'public' && (
                        <p className="mt-1 text-xs text-gray-500">{t('users.detail.publicInert')}</p>
                      )}
                      {rida.editBasis === 'role_based' && (
                        <p className="mt-1 text-xs text-gray-500">{t('users.detail.inertScope')}</p>
                      )}
                      {ulatusIlmaLugemiseta && (
                        <p className="mt-1 text-xs text-amber-700">
                          {t('users.detail.scopeWithoutRead')}{' '}
                          <button
                            type="button"
                            className="underline"
                            disabled={salvestan || !voibHallata}
                            onClick={() => lyliti(rida.collectionId, 'allowed', true)}
                          >
                            {t('users.detail.addReadRight')}
                          </button>
                        </p>
                      )}
                    </li>
                  );
                })}
              </ul>

              {mustand && (addableAllowed(kogud, mustand).length > 0
                || addableEdit(kogud, mustand, target.role).length > 0) && (
                <div className="mt-3 flex flex-wrap gap-2">
                  {addableAllowed(kogud, mustand).length > 0 && (
                    <select
                      value=""
                      disabled={salvestan || !voibHallata}
                      onChange={e => {
                        if (e.target.value) lyliti(e.target.value, 'allowed', true);
                      }}
                      className="text-xs border border-gray-300 rounded px-1.5 py-0.5 focus:outline-none focus:ring-2 focus:ring-primary-500 disabled:opacity-50"
                    >
                      <option value="">{t('users.detail.addRead')}</option>
                      {addableAllowed(kogud, mustand).map(c => (
                        <option key={c.id} value={c.id}>{c.name}</option>
                      ))}
                    </select>
                  )}
                  {addableEdit(kogud, mustand, target.role).length > 0 && (
                    <select
                      value=""
                      disabled={salvestan || !voibHallata}
                      onChange={e => {
                        if (e.target.value) lyliti(e.target.value, 'edit', true);
                      }}
                      className="text-xs border border-gray-300 rounded px-1.5 py-0.5 focus:outline-none focus:ring-2 focus:ring-primary-500 disabled:opacity-50"
                    >
                      <option value="">{t('users.detail.addScope')}</option>
                      {addableEdit(kogud, mustand, target.role).map(c => (
                        <option key={c.id} value={c.id}>{c.name}</option>
                      ))}
                    </select>
                  )}
                </div>
              )}

              {delta.length > 0 && (
                <div className="mt-3 rounded border border-amber-200 bg-amber-50 p-2">
                  <p className="text-xs text-amber-800">{t('users.detail.sessionWarning')}</p>
                </div>
              )}

              <div className="mt-3 flex gap-2">
                <button
                  type="button"
                  className="inline-flex items-center gap-1 rounded bg-indigo-600 px-3 py-1.5 text-sm text-white disabled:opacity-50"
                  disabled={delta.length === 0 || salvestan || !voibHallata}
                  onClick={salvestaOigused}
                >
                  {salvestan
                    ? <><Loader2 className="animate-spin" size={14} /> {t('users.detail.saving')}</>
                    : t('users.detail.save')}
                </button>
                <button
                  type="button"
                  className="rounded border border-gray-300 px-3 py-1.5 text-sm disabled:opacity-50"
                  disabled={delta.length === 0 || salvestan}
                  onClick={() => { if (laetud) { setMustand(klooni(laetud)); setViga(null); } }}
                >
                  {t('users.detail.cancel')}
                </button>
              </div>
                </>
              )}
            </section>

            {/* Töökollektsioonid (kolmas telg, eraldi failid ja revision) */}
            <section className="bg-white rounded-lg border border-gray-200 p-4">
              <h2 className="text-lg font-semibold text-gray-800">{t('users.detail.workSetsTitle')}</h2>
              {workSets.length === 0 ? (
                <p className="mt-2 text-sm text-gray-500">{t('workSets.empty')}</p>
              ) : (
                <div className="mt-2 flex flex-col gap-1">
                  {workSets.map(ws => (
                    <label key={ws.id} className="flex items-center gap-2 text-sm">
                      <select
                        value={wsMustand[ws.id] ?? ''}
                        disabled={!voibHallata || !ws.can_manage || wsSalvestan}
                        onChange={e => setWsMustand(prev => ({
                          ...prev,
                          [ws.id]: (e.target.value || null) as SetRole | null,
                        }))}
                        className="text-xs border border-gray-300 rounded px-1.5 py-0.5 focus:outline-none focus:ring-2 focus:ring-primary-500 disabled:opacity-50"
                      >
                        <option value="">{t('workSets.none')}</option>
                        <option value="viewer">{t('workSets.viewer')}</option>
                        <option value="manager">{t('workSets.manager')}</option>
                      </select>
                      <span className="truncate">
                        {wsNimi(ws)}
                        {ws.status === 'archived' && ` (${t('workSets.statusArchived')})`}
                      </span>
                    </label>
                  ))}
                </div>
              )}
              <p className="mt-2 text-xs text-gray-500">{t('workSets.userAccessHint')}</p>
              {/* Sessioonihoiatust siia EI panda: töökollektsiooni `access`
                  muudatus sessioone ei lõpeta (spekk §5). */}

              {wsTulemus && (wsTulemus.saved.length > 0 || wsTulemus.failed.length > 0) && (
                <div className="mt-3 text-xs">
                  {wsTulemus.saved.length > 0 && (
                    <p className="text-green-700">
                      {t('users.detail.workSetsSaved', { names: wsTulemus.saved.join(', ') })}
                    </p>
                  )}
                  {wsTulemus.failed.length > 0 && (
                    <>
                      <p className="text-red-700">
                        {t('users.detail.workSetsFailed', { names: wsTulemus.failed.join(', ') })}
                      </p>
                      <p className="text-amber-700">{t('users.detail.workSetsConflictHint')}</p>
                    </>
                  )}
                </div>
              )}

              <div className="mt-3">
                <button
                  type="button"
                  className="inline-flex items-center gap-1 rounded bg-indigo-600 px-3 py-1.5 text-sm text-white disabled:opacity-50"
                  disabled={!wsMuudatusi || wsSalvestan || !voibHallata}
                  onClick={salvestaKogud}
                >
                  {wsSalvestan
                    ? <><Loader2 className="animate-spin" size={14} /> {t('users.detail.saving')}</>
                    : t('users.detail.save')}
                </button>
              </div>
            </section>
          </div>
        )}
      </div>
    </div>
  );
};

export default UserDetail;
