import React, { useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Loader2, ChevronLeft } from 'lucide-react';
import Header from '../../components/Header';
import CollectionEditor from '../../components/CollectionEditor';
import { useUser } from '../../contexts/UserContext';

const Collections: React.FC = () => {
  const { t } = useTranslation(['admin', 'common']);
  const { user, isLoading: userLoading } = useUser();
  const navigate = useNavigate();

  useEffect(() => {
    if (!userLoading && (!user || user.role !== 'admin')) {
      navigate('/');
    }
  }, [user, userLoading, navigate]);

  if (userLoading || !user) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-primary-600" />
      </div>
    );
  }

  if (user.role !== 'admin') return null;

  return (
    <div className="min-h-screen bg-gray-50">
      <Header showSearchButton={false} pageTitle={t('admin:collections.tab')} />
      <div className="max-w-4xl mx-auto px-4 py-8">
        <Link to="/admin" className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700 mb-6">
          <ChevronLeft size={16} />
          Admin
        </Link>

        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <CollectionEditor />
        </div>
      </div>
    </div>
  );
};

export default Collections;
