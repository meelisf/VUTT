import React, { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { UserPlus, Users, Upload, Library, History, Trash2, RefreshCw } from 'lucide-react';
import Header from '../components/Header';
import { useUser } from '../contexts/UserContext';
import { fetchWithTimeout, getAuthHeaders } from '../utils/fetchWithTimeout';
import { FILE_API_URL } from '../config';

const FILE_SERVER = import.meta.env.VITE_FILE_SERVER_URL;

interface AdminCard {
  key: string;
  icon: React.ReactNode;
  group: string;
  href: string;
  count?: number;
  countColor?: string;
}

const Admin: React.FC = () => {
  const { t } = useTranslation(['admin', 'common']);
  const { user, authToken } = useUser();
  const navigate = useNavigate();
  const [pendingCount, setPendingCount] = useState<number | null>(null);
  const [uploadCount, setUploadCount] = useState<number | null>(null);

  type ActionState = 'idle' | 'running' | 'done' | 'error';
  const [placeLabelsState, setPlaceLabelsState] = useState<ActionState>('idle');
  const [placeLabelsCount, setPlaceLabelsCount] = useState<number | null>(null);
  const [entityLabelsState, setEntityLabelsState] = useState<ActionState>('idle');
  const [entityLabelsCount, setEntityLabelsCount] = useState<number | null>(null);

  useEffect(() => {
    if (!user || user.role !== 'admin') {
      navigate('/');
      return;
    }
  }, [user, navigate]);

  useEffect(() => {
    if (!authToken) return;
    fetchWithTimeout(`${FILE_SERVER}/registrations`, {
      headers: getAuthHeaders(authToken),
    })
      .then(r => r.json())
      .then(data => {
        const pending = (data || []).filter((r: any) => r.status === 'pending').length;
        setPendingCount(pending);
      })
      .catch(() => {});
    fetchWithTimeout(`${FILE_API_URL}/admin/uploads`, {
      headers: getAuthHeaders(authToken),
    })
      .then(r => r.json())
      .then(data => {
        const active = (data?.uploads || []).filter(
          (u: any) => u.status !== 'imported'
        ).length;
        setUploadCount(active);
      })
      .catch(() => {});
  }, [authToken]);

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

  if (!user || user.role !== 'admin') return null;

  const cards: AdminCard[] = [
    {
      key: 'registrations',
      icon: <UserPlus size={18} className="text-indigo-700" />,
      group: t('admin:groups.users'),
      href: '/admin/registrations',
      count: pendingCount ?? undefined,
      countColor: 'text-red-600',
    },
    {
      key: 'users',
      icon: <Users size={18} className="text-blue-600" />,
      group: t('admin:groups.users'),
      href: '/admin/users',
    },
    {
      key: 'upload',
      icon: <Upload size={18} className="text-teal-600" />,
      group: t('admin:groups.content'),
      href: '/upload',
      count: uploadCount ?? undefined,
      countColor: 'text-teal-700',
    },
    {
      key: 'collections',
      icon: <Library size={18} className="text-violet-600" />,
      group: t('admin:groups.settings'),
      href: '/admin/collections',
    },
    {
      key: 'changes',
      icon: <History size={18} className="text-amber-600" />,
      group: t('admin:groups.workflow'),
      href: '/review',
    },
    {
      key: 'trash',
      icon: <Trash2 size={18} className="text-rose-600" />,
      group: t('admin:groups.content'),
      href: '/admin/trash',
    },
  ];

  return (
    <div className="min-h-screen bg-gray-50">
      <Header showSearchButton={false} pageTitle="Admin" />
      <div className="max-w-5xl mx-auto px-4 py-8">
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
          {cards.map(card => (
            <Link
              key={card.key}
              to={card.href}
              className="bg-white border border-gray-200 rounded-lg p-4 hover:shadow-md transition-shadow cursor-pointer"
            >
              <div className="flex items-center gap-2 mb-2">
                {card.icon}
                <span className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
                  {card.group}
                </span>
              </div>
              <p className="font-semibold text-gray-900 text-sm">
                {t(`admin:cards.${card.key}`)}
              </p>
              {card.count !== undefined && card.count > 0 && (
                <p className={`text-xs font-medium mt-1 ${card.countColor}`}>
                  {t('admin:cards.pending', { count: card.count })}
                </p>
              )}
            </Link>
          ))}
        </div>

        <div className="mt-8">
          <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">
            {t('admin:maintenance.title')}
          </h2>
          <div className="bg-white border border-gray-200 rounded-lg divide-y divide-gray-100">
            {([
              {
                key: 'placeLabels',
                label: t('admin:maintenance.refreshPlaceLabels'),
                desc: t('admin:maintenance.refreshPlaceLabelsDesc'),
                state: placeLabelsState,
                count: placeLabelsCount,
                doneKey: 'refreshPlaceLabelsDone',
                onClick: handleRefreshPlaceLabels,
              },
              {
                key: 'entityLabels',
                label: t('admin:maintenance.refreshEntityLabels'),
                desc: t('admin:maintenance.refreshEntityLabelsDesc'),
                state: entityLabelsState,
                count: entityLabelsCount,
                doneKey: 'refreshEntityLabelsDone',
                onClick: handleRefreshEntityLabels,
              },
            ] as const).map(({ key, label, desc, state, count, doneKey, onClick }) => (
              <div key={key} className="flex items-center justify-between px-4 py-3 gap-4">
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
                  {state === 'running' ? t('admin:maintenance.refreshing') : label}
                </button>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

export default Admin;
