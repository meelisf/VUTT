import React from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { Home } from 'lucide-react';
import Header from '../components/Header';

// 404 lehekülg - kuvatakse kui marsruuti ei leita
const NotFound: React.FC = () => {
  const { t } = useTranslation(['common']);

  return (
    <div className="min-h-screen bg-gray-50">
      <Header />
      <main className="max-w-2xl mx-auto px-4 py-16 text-center">
        <h1 className="text-6xl font-bold text-gray-300 mb-4">404</h1>
        <h2 className="text-2xl font-semibold text-gray-700 mb-4">
          {t('notFound.title')}
        </h2>
        <p className="text-gray-500 mb-8">
          {t('notFound.description')}
        </p>

        <Link
          to="/"
          className="inline-flex items-center justify-center gap-2 px-6 py-3 bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition-colors"
        >
          <Home className="w-5 h-5" />
          {t('notFound.home')}
        </Link>
      </main>
    </div>
  );
};

export default NotFound;
