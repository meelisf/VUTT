/**
 * Kollektsiooni detailvaade (#318, spekk §4).
 *
 * Kolm plokki rollide järgi: „Teosed" (LINK otsingusse — teoste kuuluvus elab
 * `_metadata.json`-is ja otsingus, ADR 0007, siia uut lugemisteed ei tehta),
 * „Ligipääs" (admin+, olemasolev `CollectionAccessPanel`) ja „Seaded"
 * (superadmin, olemasolev `CollectionEditor` ilma oma valija ja ilma sisemise
 * ligipääsupaneelita).
 *
 * Peitmine ei ole autoriseerimine: server hoiab seadete endpointidel
 * `require_role("superadmin")`-i.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ChevronLeft, Loader2 } from 'lucide-react';
import Header from '../../components/Header';
import CollectionEditor from '../../components/CollectionEditor';
import CollectionAccessPanel from '../../components/CollectionAccessPanel';
import { useCollection } from '../../contexts/CollectionContext';
import { useUser } from '../../contexts/UserContext';
import { isAtLeast } from '../../utils/roleUtils';
import { getLangCode } from '../../utils/getLangCode';
import { apiPost } from '../../services/apiClient';
import { RightsUser } from './collectionRightsDraft';

type Tab = 'works' | 'access' | 'settings';

const CollectionDetail: React.FC = () => {
  const { t, i18n } = useTranslation(['admin', 'common']);
  const { id = '' } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const { user, authToken, isLoading: userLoading } = useUser();
  const { collections, isLoading: collectionsLoading, refreshCollections } = useCollection();
  const lang = getLangCode(i18n.language);

  const isAdmin = isAtLeast(user?.role, 'admin');
  const isSuperadmin = isAtLeast(user?.role, 'superadmin');

  // Ligipääsupaneeli üldloend on ADMINI oma (nagu WorkSets.tsx-is). `usersKnown`
  // eristab „loend on tõesti tühi" ja „loendit ei saanud laadida" (1b õppetund).
  const [users, setUsers] = useState<RightsUser[]>([]);
  const [usersKnown, setUsersKnown] = useState(false);

  useEffect(() => {
    if (!isAdmin || !authToken) return;
    apiPost<{ status: string; users?: RightsUser[] }>('/admin/users', {}, { token: authToken })
      .then(d => { setUsers(d.users || []); setUsersKnown(true); })
      // Loendi puudumine ei blokeeri paneeli: olemasolevad määrangud jäävad
      // nähtavaks, ainult lisamine jääb tegemata.
      .catch(() => { setUsers([]); setUsersKnown(false); });
  }, [isAdmin, authToken]);

  // Paneelile stabiilne viide: objektiliteraal iga renderduse peal käivitaks
  // paneeli memo'd uuesti.
  const actor = useMemo(
    () => ({ username: user?.username || '', role: user?.role || '' }),
    [user]);

  useEffect(() => {
    if (!userLoading && !user) navigate('/');
  }, [user, userLoading, navigate]);

  const kogu = collections[id];

  // Tabid elavad AINULT URL-is (ADR 0038): siin ei hoita neist koopiat ega
  // kirjutata teist peeglit. `?tab=` on ainus URL-i kirjutaja.
  const allowed: Tab[] = isAdmin ? ['works', 'access', 'settings'] : ['works'];
  const vaikimisi: Tab = isAdmin ? 'access' : 'works';
  const soovitud = searchParams.get('tab') as Tab | null;
  const tab: Tab = soovitud && allowed.includes(soovitud) ? soovitud : vaikimisi;
  const vahetaTab = (uus: Tab) => {
    setSearchParams({ tab: uus }, { replace: true });
  };

  if (userLoading || !user) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-primary-600" />
      </div>
    );
  }

  // Laadimata kontekst EI tähenda „kollektsiooni ei ole" — spinner enne otsust.
  if (collectionsLoading) {
    return (
      <div className="min-h-screen bg-gray-50">
        <Header showSearchButton={false} pageTitle={t('collections.hub.title')} />
        <div className="flex justify-center py-12">
          <Loader2 className="w-8 h-8 animate-spin text-gray-400" />
        </div>
      </div>
    );
  }

  if (!kogu) {
    return (
      <div className="min-h-screen bg-gray-50">
        <Header showSearchButton={false} pageTitle={t('collections.hub.title')} />
        <div className="max-w-5xl mx-auto px-4 py-8">
          <Link to="/admin/collections" className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700 mb-6">
            <ChevronLeft size={16} />
            {t('collections.hub.title')}
          </Link>
          <p className="text-gray-600">{t('collections.hub.notFound')}</p>
        </div>
      </div>
    );
  }

  const nimi = kogu.name?.[lang] || kogu.name?.et || id;

  return (
    <div className="min-h-screen bg-gray-50">
      <Header showSearchButton={false} pageTitle={t('collections.hub.title')} />
      <div className="max-w-5xl mx-auto px-4 py-8">
        <Link to="/admin/collections" className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700 mb-6">
          <ChevronLeft size={16} />
          {t('collections.hub.title')}
        </Link>

        <div className="flex items-center gap-2 flex-wrap mb-6">
          <h1 className="text-2xl font-bold text-gray-800">{nimi}</h1>
          {kogu.type === 'virtual_group' && (
            <span className="text-xs bg-violet-50 text-violet-700 border border-violet-200 px-1.5 py-0.5 rounded">
              {t('collections.hub.badgeVirtual')}
            </span>
          )}
          {kogu.visibility === 'restricted' && (
            <span className="text-xs bg-amber-50 text-amber-700 border border-amber-200 px-1.5 py-0.5 rounded">
              {t('collections.hub.badgeRestricted')}
            </span>
          )}
        </div>

        <div className="bg-white rounded-xl border border-gray-200">
          <div className="flex border-b border-gray-200 overflow-x-auto">
            <button
              onClick={() => vahetaTab('works')}
              className={`px-4 py-3 text-sm font-medium whitespace-nowrap border-b-2 ${
                tab === 'works'
                  ? 'border-primary-600 text-primary-700'
                  : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
              {t('collections.hub.tabWorks')}
            </button>
            {isAdmin && (
              <button
                onClick={() => vahetaTab('access')}
                className={`px-4 py-3 text-sm font-medium whitespace-nowrap border-b-2 ${
                  tab === 'access'
                    ? 'border-primary-600 text-primary-700'
                    : 'border-transparent text-gray-500 hover:text-gray-700'
                }`}
              >
                {t('collections.hub.tabAccess')}
              </button>
            )}
            {isAdmin && (
              <button
                onClick={() => vahetaTab('settings')}
                className={`px-4 py-3 text-sm font-medium whitespace-nowrap border-b-2 ${
                  tab === 'settings'
                    ? 'border-primary-600 text-primary-700'
                    : 'border-transparent text-gray-500 hover:text-gray-700'
                }`}
              >
                {t('collections.hub.tabSettings')}
              </button>
            )}
          </div>

          <div className="p-6">
            {tab === 'works' && (
              // „Teosed" EI OLE uus lugemistee: link läheb otsingusse, kus
              // kuuluvus tuleb `_metadata.json`-ist (ADR 0007). Parameeter on
              // `collection` ainsuses ja paljas id — seda loeb
              // `useCollectionUrlSync` → `decideCollectionSync` (ADR 0038).
              <Link
                to={'/search?collection=' + encodeURIComponent(id)}
                className="inline-flex items-center text-sm font-medium text-primary-600 hover:text-primary-700"
              >
                {t('collections.hub.worksLink')}
              </Link>
            )}

            {tab === 'access' && isAdmin && (
              <CollectionAccessPanel
                collectionId={id}
                users={users}
                usersKnown={usersKnown}
                actor={actor}
                onSaved={() => { void refreshCollections(); }}
              />
            )}

            {tab === 'settings' && (
              isSuperadmin ? (
                <CollectionEditor
                  canEditSettings
                  selectedId={id}
                  showPicker={false}
                  // Ligipääs on siin OMAETTE tab — editori sisemine paneel
                  // oleks sama asja teine koopia.
                  showAccessPanel={false}
                  // Kustutamise järel suunab editor valiku tühjaks — hubi
                  // marsruut on siis õige sihtkoht, mitte kustutatud kogu.
                  onSelectId={(uusId) => navigate(
                    uusId ? `/admin/collections/${uusId}` : '/admin/collections')}
                />
              ) : (
                <p className="text-sm text-gray-500">{t('collections.hub.settingsSuperadminOnly')}</p>
              )
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default CollectionDetail;