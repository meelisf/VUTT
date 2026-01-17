import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router-dom';
import {
  ArrowLeft,
  Clock,
  User,
  FileText,
  ExternalLink,
  Loader2,
  AlertCircle,
  ChevronDown,
  LogOut,
  Settings,
  Filter,
  History
} from 'lucide-react';
import LanguageSwitcher from '../components/LanguageSwitcher';
import { FILE_API_URL } from '../config';
import { useUser } from '../contexts/UserContext';

interface RecentCommit {
  commit_hash: string;
  full_hash: string;
  author: string;
  date: string;
  formatted_date: string;
  message: string;
  teose_id: string;
  lehekylje_number: number;
  filepath: string;
}

const Review: React.FC = () => {
  const { t } = useTranslation(['review', 'common']);
  const { user, authToken: token, logout, isLoading: userLoading } = useUser();
  const navigate = useNavigate();

  const [commits, setCommits] = useState<RecentCommit[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showUserMenu, setShowUserMenu] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [filterUser, setFilterUser] = useState<string | null>(null);
  const [showOnlyMine, setShowOnlyMine] = useState(false);

  // Kontrolli ligipääsu (oota kuni kasutaja andmed on laetud)
  useEffect(() => {
    if (!userLoading && (!user || !token)) {
      navigate('/');
    }
  }, [user, token, userLoading, navigate]);

  // Lae muudatused kui kasutaja on olemas
  useEffect(() => {
    if (user && token) {
      loadRecentEdits();
    }
  }, [user, token, showOnlyMine]);

  const loadRecentEdits = async () => {
    if (!token) return;
    
    setLoading(true);
    setError(null);

    try {
      let url = `${FILE_API_URL}/recent-edits?token=${token}&limit=50`;
      
      // Kui kasutaja tahab ainult oma muudatusi (admin valib seda)
      if (showOnlyMine && user) {
        url += `&user=${encodeURIComponent(user.name)}`;
      }

      const response = await fetch(url);
      const data = await response.json();

      if (data.status === 'success') {
        setCommits(data.commits);
        setIsAdmin(data.is_admin);
        setFilterUser(data.filtered_by);
      } else {
        setError(data.message || t('error'));
      }
    } catch (err) {
      console.error('Muudatuste laadimine ebaõnnestus:', err);
      setError(t('error'));
    } finally {
      setLoading(false);
    }
  };

  // Grupeeri commitid kasutaja järgi (ainult admin jaoks)
  const getUniqueAuthors = (): string[] => {
    const authors = new Set(commits.map(c => c.author));
    return Array.from(authors).sort();
  };

  if (!user) {
    return null;
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-primary-50 to-amber-50">
      {/* Header */}
      <header className="bg-white shadow-sm sticky top-0 z-30">
        <div className="max-w-7xl mx-auto px-4 py-3 flex items-center justify-between">
          <Link to="/" className="flex items-center gap-2 text-primary-600 hover:text-primary-700">
            <ArrowLeft size={20} />
            <span className="font-medium">{t('common:buttons.back')}</span>
          </Link>

          <div className="flex items-center gap-4">
            <LanguageSwitcher />

            {/* Kasutaja menüü */}
            <div className="relative">
              <button
                onClick={() => setShowUserMenu(!showUserMenu)}
                className="flex items-center gap-2 px-3 py-1.5 rounded-lg hover:bg-gray-100 transition-colors"
              >
                <span className="text-sm text-gray-600 hidden sm:block">{user.name}</span>
                <div className="h-8 w-8 bg-primary-100 rounded-full flex items-center justify-center text-primary-700 font-bold text-sm">
                  {user.name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase()}
                </div>
                <ChevronDown size={16} className={`text-gray-400 transition-transform ${showUserMenu ? 'rotate-180' : ''}`} />
              </button>

              {showUserMenu && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setShowUserMenu(false)} />
                  <div className="absolute right-0 top-full mt-1 bg-white rounded-lg shadow-lg border border-gray-200 py-1 min-w-48 z-50">
                    {user.role === 'admin' && (
                      <Link
                        to="/admin"
                        onClick={() => setShowUserMenu(false)}
                        className="flex items-center gap-2 px-4 py-2 text-sm text-gray-700 hover:bg-gray-100"
                      >
                        <Settings size={16} />
                        {t('common:nav.admin')}
                      </Link>
                    )}
                    {user.role === 'admin' && <div className="border-t border-gray-100 my-1" />}
                    <button
                      onClick={() => { setShowUserMenu(false); logout(); }}
                      className="flex items-center gap-2 px-4 py-2 text-sm text-red-600 hover:bg-red-50 w-full"
                    >
                      <LogOut size={16} />
                      {t('common:buttons.logout')}
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      </header>

      {/* Main content */}
      <main className="max-w-5xl mx-auto px-4 py-8">
        <div className="bg-white rounded-xl shadow-lg overflow-hidden">
          {/* Title */}
          <div className="px-6 py-5 border-b border-gray-200">
            <div className="flex items-center justify-between">
              <div>
                <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-3">
                  <History className="text-primary-600" size={28} />
                  {t('title')}
                </h1>
                <p className="text-gray-500 mt-1">
                  {isAdmin ? t('subtitleAdmin') : t('subtitle')}
                </p>
              </div>

              {/* Filter (ainult admin) */}
              {isAdmin && (
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setShowOnlyMine(!showOnlyMine)}
                    className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm transition-colors ${
                      showOnlyMine 
                        ? 'bg-primary-100 text-primary-700 border border-primary-200' 
                        : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                    }`}
                  >
                    <Filter size={16} />
                    {showOnlyMine ? t('filters.onlyMine') : t('filters.all')}
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* Content */}
          <div className="p-6">
            {loading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="animate-spin text-primary-600" size={32} />
                <span className="ml-3 text-gray-600">{t('loading')}</span>
              </div>
            ) : error ? (
              <div className="flex items-center justify-center py-12 text-red-600">
                <AlertCircle size={24} className="mr-2" />
                {error}
              </div>
            ) : commits.length === 0 ? (
              <div className="text-center py-12">
                <History className="mx-auto text-gray-300" size={48} />
                <p className="mt-4 text-gray-500">
                  {isAdmin ? t('empty') : t('emptyUser')}
                </p>
              </div>
            ) : (
              <div className="space-y-2">
                {/* Tabeli päis */}
                <div className="hidden sm:grid sm:grid-cols-12 gap-4 px-4 py-2 text-sm text-gray-500 font-medium border-b border-gray-200">
                  <div className="col-span-2">{t('table.when')}</div>
                  {isAdmin && !showOnlyMine && (
                    <div className="col-span-2">{t('table.who')}</div>
                  )}
                  <div className={isAdmin && !showOnlyMine ? "col-span-4" : "col-span-5"}>{t('table.where')}</div>
                  <div className={isAdmin && !showOnlyMine ? "col-span-3" : "col-span-4"}>{t('table.what')}</div>
                  <div className="col-span-1"></div>
                </div>

                {/* Tabeli read */}
                {commits.map((commit, index) => (
                  <div 
                    key={`${commit.commit_hash}-${index}`} 
                    className="grid grid-cols-1 sm:grid-cols-12 gap-2 sm:gap-4 px-4 py-3 hover:bg-gray-50 rounded-lg border border-gray-100 sm:border-0 sm:border-b"
                  >
                    {/* Kuupäev */}
                    <div className="col-span-2 flex items-center gap-2 text-sm text-gray-600">
                      <Clock size={14} className="text-gray-400 hidden sm:block" />
                      <span className="sm:hidden text-xs text-gray-400">{t('table.when')}:</span>
                      {commit.formatted_date}
                    </div>
                    
                    {/* Kasutaja (ainult admin) */}
                    {isAdmin && !showOnlyMine && (
                      <div className="col-span-2 flex items-center gap-2">
                        <div className="h-6 w-6 bg-primary-100 rounded-full flex items-center justify-center text-primary-700 font-bold text-xs flex-shrink-0">
                          {commit.author.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase()}
                        </div>
                        <span className="text-sm text-gray-700 truncate">{commit.author}</span>
                      </div>
                    )}
                    
                    {/* Koht (teose_id + lk) */}
                    <div className={`${isAdmin && !showOnlyMine ? "col-span-4" : "col-span-5"} flex items-center gap-2 min-w-0`}>
                      <FileText size={14} className="text-gray-400 flex-shrink-0 hidden sm:block" />
                      <span className="text-sm font-medium text-gray-900 truncate" title={commit.teose_id}>
                        {commit.teose_id}
                      </span>
                      <span className="text-xs text-gray-500 bg-gray-100 px-1.5 py-0.5 rounded flex-shrink-0">
                        lk {commit.lehekylje_number}
                      </span>
                    </div>
                    
                    {/* Tegevus */}
                    <div className={`${isAdmin && !showOnlyMine ? "col-span-3" : "col-span-4"} flex items-center min-w-0`}>
                      <span className="text-sm text-gray-600 truncate" title={commit.message}>
                        {commit.message}
                      </span>
                    </div>
                    
                    {/* Link */}
                    <div className="col-span-1 flex items-center justify-end">
                      <Link
                        to={`/work/${commit.teose_id}/${commit.lehekylje_number}`}
                        className="inline-flex items-center gap-1 p-2 text-primary-600 hover:text-primary-700 hover:bg-primary-50 rounded-lg transition-colors"
                        title={t('actions.openPage')}
                      >
                        <ExternalLink size={18} />
                      </Link>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  );
};

export default Review;
