/**
 * Kasutajate haldusloend (#318, spekk §1, etapp 3b).
 *
 * Kompaktne otsitav nimekiri. Filtrid elavad AINULT URL-is
 * (`?q=&role=&rights_collection=&rights_work_set=`) — paralleelset
 * `useState`-koopiat ei hoita, sest kaks tingimusteta peeglit tekitaksid
 * lõputu tsükli (ADR 0038 / #333). Filtrid on HALDUSLOENDI filtrid, mitte
 * koguvalik: `useCollectionUrlSync`-i ei kutsuta ja aktiivne kogu ei muutu.
 *
 * Konto toimingud ja õiguste toimetamine kolisid detailvaatesse
 * (`UserDetail.tsx`, etapp 3a) — siin neid enam ei ole.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Loader2, ChevronLeft, Users } from 'lucide-react';
import Header from '../../components/Header';
import { useUser } from '../../contexts/UserContext';
import { useCollection } from '../../contexts/CollectionContext';
import { WorkSetSummary, listWorkSets } from '../../services/workSetService';
import { getLangCode } from '../../utils/getLangCode';
import { formatDateTime } from '../../utils/formatDateTime';
import { apiPost } from '../../services/apiClient';
import { ROLE_LEVELS, roleLevel } from '../../utils/roleUtils';
import { getUserActivity, UserActivity } from '../../services/userActivityService';
import {
  EMPTY_FILTERS, filterUsers, filtersFromParams, paramsFromFilters, UserFilters,
} from './userListFilter';

interface User {
  username: string;
  name: string;
  email: string;
  role: 'contributor' | 'editor' | 'admin' | 'superadmin';
  created_at: string | null;
  allowed_collections?: string[];
  edit_collections?: string[];
}

interface UsersResponse {
  status: 'success' | 'error';
  users?: User[];
  message?: string;
}

const UsersPage: React.FC = () => {
  const { t, i18n } = useTranslation(['admin', 'common']);
  const lang = getLangCode(i18n.language);
  const { user, authToken, isLoading: userLoading } = useUser();
  const { collections } = useCollection();
  const navigate = useNavigate();

  const [users, setUsers] = useState<User[]>([]);
  const [usersLoading, setUsersLoading] = useState(false);
  const [usersError, setUsersError] = useState<string | null>(null);
  // Aktiivsus on `null` ka laadimise ajal ja vea korral: kriips tähendab
  // „vastet ei ole", mitte „viga" (vt allpool).
  const [activity, setActivity] = useState<UserActivity | null>(null);
  const [activityFailed, setActivityFailed] = useState(false);
  const [aktiivneRida, setAktiivneRida] = useState(0);
  const aktiivneRef = useRef<HTMLLIElement | null>(null);

  // Töökollektsioonid (#354): filter vajab `access`-kaarte, seega arhiveeritud
  // kaasa — muidu ei saa arhiivis koguga seotud inimesi filtreerida.
  const [workSets, setWorkSets] = useState<WorkSetSummary[]>([]);

  // Filtrid tulevad AINULT URL-ist. `filters` on tuletis, mitte koopia —
  // URL-i kirjutab ainult `seaFilter`.
  const [searchParams, setSearchParams] = useSearchParams();
  const filters = useMemo(() => filtersFromParams(searchParams), [searchParams]);

  const loadUsers = useCallback(async () => {
    setUsersLoading(true);
    setUsersError(null);

    try {
      const data = await apiPost<UsersResponse>('/admin/users', {}, { token: authToken });

      if (data.status === 'success') {
        setUsers(data.users || []);
      } else {
        setUsersError(data.message || t('users.loadError'));
      }
    } catch (e) {
      console.error('Load users error:', e);
      setUsersError(t('users.connectionError'));
    } finally {
      setUsersLoading(false);
    }
  }, [authToken, t]);

  useEffect(() => {
    if (!userLoading && (!user || roleLevel(user.role) < ROLE_LEVELS.admin)) {
      navigate('/');
    }
  }, [user, userLoading, navigate]);

  useEffect(() => {
    if (authToken && user && roleLevel(user.role) >= ROLE_LEVELS.admin) {
      loadUsers();
      // Arhiveeritud kaasa: kasutajal võib olla õigus kogule, mis on arhiivis,
      // ja selle vaikne peitmine teeks õiguse eemaldamise võimatuks.
      listWorkSets(true).then(setWorkSets).catch(() => setWorkSets([]));
    }
  }, [authToken, user, loadUsers]);

  useEffect(() => {
    getUserActivity()
      .then(a => { setActivity(a); setActivityFailed(false); })
      // Aktiivsuse viga EI blokeeri kasutajahaldust ega tähenda tegevusetust:
      // kriips tähendaks „ei ole midagi teinud" ja oleks siin vale vastus.
      .catch(() => { setActivity(null); setActivityFailed(true); });
  }, []);

  /**
   * Ainus koht, mis URL-i kirjutab. Admin-filtrid EI puutu `CollectionContext`-i
   * ega aktiivset kogu (ADR 0038): need on haldusloendi filtrid, mitte koguvalik.
   * `replace: true` — iga klahvivajutus ei tohi tekitada ajaloo-kirjet.
   */
  const seaFilter = (muutus: Partial<UserFilters>) => {
    setSearchParams(paramsFromFilters({ ...filters, ...muutus }), { replace: true });
    setAktiivneRida(0);
  };

  const kustutaFiltrid = () => {
    setSearchParams(paramsFromFilters(EMPTY_FILTERS), { replace: true });
    setAktiivneRida(0);
  };

  const kogudValik = useMemo(
    () => Object.entries(collections)
      .map(([id, c]) => ({ id, name: c.name?.[lang] || c.name?.et || id }))
      .sort((a, b) => a.name.localeCompare(b.name, 'et')),
    [collections, lang],
  );

  const workSetNimi = (ws: WorkSetSummary) =>
    ws.name[lang] || ws.name.et || ws.name.en || ws.id;

  const workSetAccess = useMemo(
    () => Object.fromEntries(
      workSets.map(ws => [ws.id, (ws.access || {}) as Record<string, string>])),
    [workSets],
  );

  const nahtavad = useMemo(
    () => filterUsers(users, filters, workSetAccess), [users, filters, workSetAccess]);

  // Indeks ei tohi jääda üle loendi lõpu (nt kasutaja kustutati teises vahekaardis
  // või filter lühendas loendit) — muidu osutaks Enter olematule reale.
  const aktiivne = nahtavad.length === 0
    ? 0
    : Math.max(0, Math.min(aktiivneRida, nahtavad.length - 1));

  useEffect(() => {
    aktiivneRef.current?.scrollIntoView({ block: 'nearest' });
  }, [aktiivne]);

  const klahv = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setAktiivneRida(i => Math.min(i + 1, nahtavad.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setAktiivneRida(i => Math.max(i - 1, 0));
    } else if (e.key === 'Enter' && nahtavad[aktiivne]) {
      navigate(`/admin/users/${nahtavad[aktiivne].username}`);
    }
  };

  const filterSeatud = Boolean(
    filters.q || filters.role || filters.rightsCollection || filters.rightsWorkSet);

  if (userLoading || !user) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-primary-600" />
      </div>
    );
  }

  if (roleLevel(user.role) < ROLE_LEVELS.admin) return null;

  const selectKlass =
    'text-sm border border-gray-300 rounded px-2 py-1 focus:outline-none focus:ring-2 focus:ring-primary-500';

  return (
    <div className="min-h-screen bg-gray-50">
      <Header showSearchButton={false} pageTitle={t('admin:tabs.users')} />
      <div className="max-w-5xl mx-auto px-4 py-8">
        <Link to="/admin" className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700 mb-6">
          <ChevronLeft size={16} />
          Admin
        </Link>

        <section>
          <h2 className="text-lg font-semibold text-gray-800 mb-4 flex items-center gap-2">
            <Users size={20} className="text-primary-600" />
            {t('users.title')}
          </h2>

          {usersError && (
            <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-lg text-red-700">
              {usersError}
            </div>
          )}

          {activityFailed && (
            <div className="mb-4 p-3 bg-amber-50 border border-amber-200 rounded-lg text-sm text-amber-800">
              {t('users.list.activityFailed')}
            </div>
          )}

          <div className="bg-white rounded-lg border border-gray-200 p-3 mb-4 flex flex-wrap items-center gap-2">
            <input
              type="text"
              autoFocus
              value={filters.q}
              onChange={e => seaFilter({ q: e.target.value })}
              onKeyDown={klahv}
              placeholder={t('users.list.searchPlaceholder')}
              className={`${selectKlass} flex-1 min-w-[12rem]`}
              aria-label={t('users.list.searchPlaceholder')}
            />
            <select
              value={filters.role}
              onChange={e => seaFilter({ role: e.target.value })}
              className={selectKlass}
              aria-label={t('users.role')}
            >
              <option value="">{t('users.list.allRoles')}</option>
              {Object.keys(ROLE_LEVELS).map(r => (
                <option key={r} value={r}>{t(`common:roles.${r}`)}</option>
              ))}
            </select>
            <select
              value={filters.rightsCollection}
              onChange={e => seaFilter({ rightsCollection: e.target.value })}
              className={selectKlass}
              aria-label={t('users.restrictedCollections')}
            >
              <option value="">{t('users.list.allCollections')}</option>
              {kogudValik.map(c => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
            {workSets.length > 0 && (
              <select
                value={filters.rightsWorkSet}
                onChange={e => seaFilter({ rightsWorkSet: e.target.value })}
                className={selectKlass}
                aria-label={t('workSets.title')}
              >
                <option value="">{t('users.list.allWorkSets')}</option>
                {workSets.map(ws => (
                  <option key={ws.id} value={ws.id}>
                    {workSetNimi(ws)}{ws.status === 'archived' ? ` (${t('workSets.statusArchived')})` : ''}
                  </option>
                ))}
              </select>
            )}
            {filterSeatud && (
              <button
                type="button"
                onClick={kustutaFiltrid}
                className="text-sm text-gray-600 hover:text-gray-900 underline"
              >
                {t('users.list.clearFilters')}
              </button>
            )}
            <span className="ml-auto text-xs text-gray-500">
              {t('users.list.count', { shown: nahtavad.length, total: users.length })}
            </span>
          </div>

          {usersLoading ? (
            <div className="flex justify-center py-8">
              <Loader2 className="w-6 h-6 animate-spin text-primary-600" />
            </div>
          ) : users.length === 0 ? (
            <div className="bg-white rounded-lg border border-gray-200 p-8 text-center text-gray-500">
              {t('users.empty')}
            </div>
          ) : nahtavad.length === 0 ? (
            <div className="bg-white rounded-lg border border-gray-200 p-8 text-center text-gray-500">
              <p>{t('users.list.noMatches')}</p>
              <button
                type="button"
                onClick={kustutaFiltrid}
                className="mt-2 text-sm text-primary-600 hover:underline"
              >
                {t('users.list.clearFilters')}
              </button>
            </div>
          ) : (
            <div className="bg-white rounded-lg border border-gray-200">
              <div className="flex flex-wrap items-center gap-x-3 px-3 py-1.5 text-xs font-medium text-gray-500 border-b border-gray-200">
                <span>{t('users.name')}</span>
                <span>{t('users.username')}</span>
                <span className="hidden sm:block">{t('users.email')}</span>
                <span>{t('users.role')}</span>
                <span className="hidden sm:block ml-auto">{t('users.list.lastChange')}</span>
              </div>
              <ul className="divide-y divide-gray-100">
              {nahtavad.map((u, i) => {
                const onIse = u.username === user.username;
                return (
                  <li
                    key={u.username}
                    ref={i === aktiivne ? aktiivneRef : undefined}
                    className={i === aktiivne ? 'ring-2 ring-primary-500 rounded' : undefined}
                  >
                    <Link
                      to={`/admin/users/${u.username}`}
                      className="flex flex-wrap items-center gap-x-3 gap-y-0.5 px-3 py-2 hover:bg-gray-50"
                    >
                      <span className="flex items-center gap-2 min-w-0">
                        <span className="font-medium text-gray-900 truncate">{u.name}</span>
                        {onIse && (
                          <span className="flex-shrink-0 text-xs bg-primary-100 text-primary-700 px-1.5 py-0.5 rounded">
                            {t('users.you')}
                          </span>
                        )}
                      </span>
                      <span className="font-mono text-xs text-gray-500 truncate">{u.username}</span>
                      <span className="hidden sm:block text-sm text-gray-600 truncate">{u.email || '-'}</span>
                      <span className="text-xs text-gray-500">{t(`common:roles.${u.role}`)}</span>
                      <span className="hidden sm:block ml-auto text-xs text-gray-400 whitespace-nowrap">
                        {activity
                          ? (activity[u.username] ? formatDateTime(activity[u.username]) : '—')
                          : ''}
                      </span>
                    </Link>
                  </li>
                );
              })}
              </ul>
            </div>
          )}
        </section>
      </div>
    </div>
  );
};

export default UsersPage;
