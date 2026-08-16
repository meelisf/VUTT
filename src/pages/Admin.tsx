import React, { useEffect, useState } from 'react';
import { isAtLeast } from '../utils/roleUtils';
import { Link, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { UserPlus, Users, Upload, Library, History, Trash2, Wrench, MapPin } from 'lucide-react';
import Header from '../components/Header';
import { useUser } from '../contexts/UserContext';
import { fetchWithTimeout, getAuthHeaders } from '../utils/fetchWithTimeout';
import { FILE_API_URL } from '../config';


interface AdminCard {
  key: string;
  icon: React.ReactNode;
  group: string;
  href: string;
  count?: number;
  countColor?: string;
  superadminOnly?: boolean;
}

const Admin: React.FC = () => {
  const { t } = useTranslation(['admin', 'common']);
  const { user, authToken } = useUser();
  const navigate = useNavigate();
  const [pendingCount, setPendingCount] = useState<number | null>(null);
  const [uploadCount, setUploadCount] = useState<number | null>(null);

  useEffect(() => {
    if (!user || !isAtLeast(user.role, 'admin')) {
      navigate('/');
      return;
    }
  }, [user, navigate]);

  useEffect(() => {
    if (!authToken) return;
    // Sama muster nagu UserMenu.tsx-is: POST + `data.registrations`.
    // Varem oli siin `${FILE_SERVER}/registrations`, kus FILE_SERVER tuli
    // muutujast VITE_FILE_SERVER_URL — seda ei ole üheski .env failis, nii et
    // päring läks aadressile "undefined/registrations" ja catch neelas vea:
    // taotluste loendur näitas alati 0.
    fetchWithTimeout(`${FILE_API_URL}/admin/registrations`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...getAuthHeaders(authToken) },
      body: JSON.stringify({}),
    })
      .then(r => r.json())
      .then(data => {
        const registrations = Array.isArray(data?.registrations) ? data.registrations : [];
        const pending = registrations.filter((r: { status?: string }) => r.status === 'pending').length;
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

  if (!user || !isAtLeast(user.role, 'admin')) return null;

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
      superadminOnly: true,
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
    {
      key: 'maintenance',
      icon: <Wrench size={18} className="text-gray-500" />,
      group: t('admin:groups.settings'),
      href: '/admin/maintenance',
    },
    {
      key: 'places',
      icon: <MapPin size={18} className="text-teal-600" />,
      group: t('admin:groups.settings'),
      href: '/admin/places',
    },
  ];

  return (
    <div className="min-h-screen bg-gray-50">
      <Header showSearchButton={false} pageTitle="Admin" />
      <div className="max-w-5xl mx-auto px-4 py-8">
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
          {cards.filter(card => !card.superadminOnly || isAtLeast(user.role, 'superadmin')).map(card => (
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

      </div>
    </div>
  );
};

export default Admin;
