import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { RefreshCw, ChevronLeft, Wrench } from 'lucide-react';
import Header from '../../components/Header';
import { FILE_API_URL } from '../../config';
import { useUser } from '../../contexts/UserContext';
import { fetchWithTimeout, getAuthHeaders } from '../../utils/fetchWithTimeout';

type ActionState = 'idle' | 'running' | 'done' | 'error';

const Maintenance: React.FC = () => {
  const { t } = useTranslation(['admin', 'common']);
  const { user, authToken, isLoading: userLoading } = useUser();
  const navigate = useNavigate();

  const [placeLabelsState, setPlaceLabelsState] = useState<ActionState>('idle');
  const [placeLabelsCount, setPlaceLabelsCount] = useState<number | null>(null);
  const [entityLabelsState, setEntityLabelsState] = useState<ActionState>('idle');
  const [entityLabelsCount, setEntityLabelsCount] = useState<number | null>(null);

  React.useEffect(() => {
    if (!userLoading && (!user || user.role !== 'admin')) {
      navigate('/');
    }
  }, [user, userLoading, navigate]);

  const handleRefreshPlaceLabels = async () => {
    if (!authToken) return;
    setPlaceLabelsState('running');
    setPlaceLabelsCount(null);
    try {
      const resp = await fetchWithTimeout(`${FILE_API_URL}/prosopography/admin/places/refresh-labels`, {
        method: 'POST',
        headers: getAuthHeaders(authToken),
        timeout: 120000,
      });
      if (!resp.ok) throw new Error(String(resp.status));
      const data = await resp.json();
      setPlaceLabelsCount(data.updated ?? 0);
      setPlaceLabelsState('done');
    } catch {
      setPlaceLabelsState('error');
    }
  };

  const handleRefreshEntityLabels = async () => {
    if (!authToken) return;
    setEntityLabelsState('running');
    setEntityLabelsCount(null);
    try {
      const resp = await fetchWithTimeout(`${FILE_API_URL}/admin/refresh-entity-labels`, {
        method: 'POST',
        headers: getAuthHeaders(authToken),
        timeout: 120000,
      });
      if (!resp.ok) throw new Error(String(resp.status));
      const data = await resp.json();
      setEntityLabelsCount(data.updated ?? 0);
      setEntityLabelsState('done');
    } catch {
      setEntityLabelsState('error');
    }
  };

  if (userLoading || !user) return null;
  if (user.role !== 'admin') return null;

  const actions = [
    {
      key: 'placeLabels',
      label: t('admin:maintenance.refreshPlaceLabels'),
      desc: t('admin:maintenance.refreshPlaceLabelsDesc'),
      state: placeLabelsState,
      count: placeLabelsCount,
      doneKey: 'refreshPlaceLabelsDone' as const,
      onClick: handleRefreshPlaceLabels,
    },
    {
      key: 'entityLabels',
      label: t('admin:maintenance.refreshEntityLabels'),
      desc: t('admin:maintenance.refreshEntityLabelsDesc'),
      state: entityLabelsState,
      count: entityLabelsCount,
      doneKey: 'refreshEntityLabelsDone' as const,
      onClick: handleRefreshEntityLabels,
    },
  ];

  return (
    <div className="min-h-screen bg-gray-50">
      <Header showSearchButton={false} pageTitle={t('admin:maintenance.title')} />
      <div className="max-w-2xl mx-auto px-4 py-8">
        <Link to="/admin" className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700 mb-6">
          <ChevronLeft size={16} />
          Admin
        </Link>

        <div className="flex items-center gap-2 mb-4">
          <Wrench size={20} className="text-gray-500" />
          <h2 className="text-lg font-semibold text-gray-800">{t('admin:maintenance.title')}</h2>
        </div>

        <div className="bg-white border border-gray-200 rounded-lg divide-y divide-gray-100">
          {actions.map(({ key, label, desc, state, count, doneKey, onClick }) => (
            <div key={key} className="flex items-center justify-between px-4 py-4 gap-4">
              <div className="min-w-0">
                <p className="text-sm font-medium text-gray-900">{label}</p>
                <p className="text-xs text-gray-400 mt-0.5">{desc}</p>
                {state === 'done' && count !== null && (
                  <p className="text-xs text-green-700 mt-1">
                    {t(`admin:maintenance.${doneKey}`, { count })}
                  </p>
                )}
                {state === 'error' && (
                  <p className="text-xs text-red-600 mt-1">{t('admin:maintenance.refreshError')}</p>
                )}
              </div>
              <button
                onClick={onClick}
                disabled={state === 'running'}
                className="shrink-0 flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border border-gray-300 rounded hover:bg-gray-50 disabled:opacity-50 text-gray-700"
              >
                <RefreshCw size={12} className={state === 'running' ? 'animate-spin' : ''} />
                {state === 'running' ? t('admin:maintenance.refreshing') : t('admin:maintenance.refresh')}
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

export default Maintenance;
