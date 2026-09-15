/**
 * Kogude ühine sisenemiskoht (#318, spekk §4).
 *
 * Üks loend, kaks mudelit: kollektsioonid hierarhias ja töökollektsioonid
 * lamedalt, tüüp igal real nähtav. Andmemudeleid ei liideta — read tulevad
 * puhtast moodulist `kogudeLoend.ts` ja rida viib olemasoleva halduse juurde.
 *
 * Tüübifilter ja otsing elavad AINULT URL-is (`?type=&q=`) ega puutu
 * `CollectionContext`-i: need on haldusfiltrid, mitte koguvalik (ADR 0038).
 */
import React, { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ChevronLeft, Loader2, Plus } from 'lucide-react';
import Header from '../../components/Header';
import { useUser } from '../../contexts/UserContext';
import { useCollection } from '../../contexts/CollectionContext';
import { isAtLeast } from '../../utils/roleUtils';
import { getLangCode } from '../../utils/getLangCode';
import { listWorkSets, WorkSetSummary } from '../../services/workSetService';
import CollectionCreateForm from '../../components/CollectionCreateForm';
import { buildKoguRows, paramFromTyyp, tyypFromParam, KoguTyyp } from './kogudeLoend';

const CollectionsHub: React.FC = () => {
  const { t, i18n } = useTranslation(['admin', 'common']);
  const { user, isLoading: userLoading } = useUser();
  const { collections, isLoading: collectionsLoading } = useCollection();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const lang = getLangCode(i18n.language);

  // Kollektsioonide pool on admin+ (server kontrollib edasi). Töökollektsiooni
  // haldur (editor/contributor) jõuab siia ilma üldise kasutajahalduseta —
  // talle jäävad ainult töökollektsioonid.
  const isAdmin = isAtLeast(user?.role, 'admin');
  // Kollektsiooni loomine on superadmin (ADR 0043 p4), töökollektsiooni oma
  // admin — sama piir nagu vastavatel endpointidel.
  const isSuperadmin = isAtLeast(user?.role, 'superadmin');

  const [workSets, setWorkSets] = useState<WorkSetSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!userLoading && !user) navigate('/');
  }, [user, userLoading, navigate]);

  // Arhiveeritud kogud on hubis nähtavad: see on haldusloend, mitte valikuloend.
  // Liikmete kohta ühtki lisa päringut EI tehta (ADR 0042).
  useEffect(() => {
    let elus = true;
    setLoading(true);
    listWorkSets(true)
      .then(data => { if (elus) { setWorkSets(data); setError(false); } })
      .catch(() => { if (elus) { setWorkSets([]); setError(true); } })
      .finally(() => { if (elus) setLoading(false); });
    return () => { elus = false; };
  }, []);

  // Filter on TULETIS URL-ist — paralleelset useState-koopiat ei ole. Kaks
  // peeglit (URL ja olek) reageeriksid teineteise eelmisele väärtusele ja
  // sünnitaksid lõputu tsükli (#333, ADR 0038).
  const tyyp = tyypFromParam(searchParams.get('type'));
  const q = searchParams.get('q') || '';
  // Ilma admini õiguseta ei ole kollektsioonide poolt olemas: ka `?type=`
  // väärtus ei tohi tühja loendit tekitada.
  const efektiivne: KoguTyyp = isAdmin ? tyyp : (tyyp === 'work_sets' ? 'work_sets' : 'all');

  const kirjutaFiltrid = (uusTyyp: KoguTyyp, uusQ: string) => {
    setSearchParams({ ...paramFromTyyp(uusTyyp), ...(uusQ ? { q: uusQ } : {}) }, { replace: true });
  };

  const read = buildKoguRows(
    isAdmin ? collections : {}, workSets, { tyyp: efektiivne, q }, lang);

  if (userLoading || !user) return null;

  const laeb = loading || collectionsLoading;

  return (
    <div className="min-h-screen bg-gray-50">
      <Header showSearchButton={false} pageTitle={t('collections.hub.title')} />
      <div className="max-w-5xl mx-auto px-4 py-8">
        <Link to="/admin" className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700 mb-6">
          <ChevronLeft size={16} />
          Admin
        </Link>

        <h1 className="text-2xl font-bold text-gray-800 mb-6">{t('collections.hub.title')}</h1>

        <div className="flex flex-col sm:flex-row gap-3 mb-6">
          <select
            value={efektiivne}
            onChange={e => kirjutaFiltrid(e.target.value as KoguTyyp, q)}
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-400 bg-white sm:w-56"
          >
            <option value="all">{t('collections.hub.typeAll')}</option>
            {isAdmin && <option value="collections">{t('collections.hub.typeCollections')}</option>}
            <option value="work_sets">{t('collections.hub.typeWorkSets')}</option>
          </select>
          <input
            type="text"
            value={q}
            autoFocus
            onChange={e => kirjutaFiltrid(efektiivne, e.target.value)}
            placeholder={t('collections.hub.searchPlaceholder')}
            className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-400"
          />
        </div>

        {/* Loomine kuulub LOENDISSE, mitte ühe kogu lehele: enne seda sai uue
            kollektsiooni teha ainult mõne olemasoleva kogu seadete alt ja
            töökollektsiooni ainult juba olemasoleva rea kaudu (#318). */}
        {isAdmin && (
          <div className="mb-6 flex flex-wrap items-start gap-x-6 gap-y-2">
            {isSuperadmin && (
              <CollectionCreateForm
                onCreated={(uusId) => navigate(`/admin/collections/${encodeURIComponent(uusId)}`)}
              />
            )}
            {isAdmin && (
              // Töökollektsiooni loomine elab `WorkSets`-is — kaks kirjutusteed
              // sama API juurde oleks duplikaat, mitte mugavus.
              <Link
                to="/admin/work-sets"
                className="inline-flex items-center gap-2 text-sm font-medium text-primary-600 hover:text-primary-700"
              >
                <Plus size={16} />
                {t('collections.hub.newWorkSet')}
              </Link>
            )}
          </div>
        )}

        {error ? (
          <p className="text-sm text-red-600">{t('common:workSets.loadFailed')}</p>
        ) : laeb ? (
          <div className="flex justify-center py-12"><Loader2 className="animate-spin text-gray-400" /></div>
        ) : read.length === 0 ? (
          q ? (
            <div className="text-center py-12 space-y-3">
              <p className="text-gray-500">{t('collections.hub.noMatches')}</p>
              <button
                onClick={() => kirjutaFiltrid(efektiivne, '')}
                className="text-sm font-medium text-primary-600 hover:text-primary-700"
              >
                {t('admin:users.list.clearFilters')}
              </button>
            </div>
          ) : (
            <p className="text-gray-500 text-center py-12">{t('collections.hub.empty')}</p>
          )
        ) : (
          <ul className="space-y-2">
            {read.map(r => (
              <li key={`${r.kind}:${r.id}`}>
                <Link
                  to={r.kind === 'collection'
                    ? `/admin/collections/${encodeURIComponent(r.id)}`
                    : `/admin/work-sets?set=${encodeURIComponent(r.id)}`}
                  style={{ marginLeft: `${r.depth}rem` }}
                  className="flex items-center gap-2 flex-wrap bg-white border border-gray-200 rounded-lg px-4 py-3 hover:shadow-sm hover:border-gray-300"
                >
                  <span className={`font-medium ${r.archived ? 'text-gray-400' : 'text-gray-800'}`}>
                    {r.name}
                  </span>
                  <span className={`text-xs px-1.5 py-0.5 rounded ${
                    r.kind === 'collection'
                      ? 'bg-violet-50 text-violet-700 border border-violet-200'
                      : 'bg-primary-50 text-primary-700 border border-primary-200'
                  }`}>
                    {r.kind === 'collection'
                      ? t('collections.hub.badgeCollection')
                      : t('collections.hub.badgeWorkSet')}
                  </span>
                  {r.isVirtual && (
                    <span className="text-xs bg-violet-50 text-violet-700 border border-violet-200 px-1.5 py-0.5 rounded">
                      {t('collections.hub.badgeVirtual')}
                    </span>
                  )}
                  {r.restricted && (
                    <span className="text-xs bg-amber-50 text-amber-700 border border-amber-200 px-1.5 py-0.5 rounded">
                      {t('collections.hub.badgeRestricted')}
                    </span>
                  )}
                  {r.archived && (
                    <span className="text-xs bg-gray-100 text-gray-600 border border-gray-200 px-1.5 py-0.5 rounded">
                      {t('collections.hub.badgeArchived')}
                    </span>
                  )}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
};

export default CollectionsHub;