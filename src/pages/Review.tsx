/**
 * Review / Viimased muudatused leht
 * 
 * Näitab Git-põhiseid viimaseid muudatusi. Kasutajad näevad oma muudatusi,
 * admin näeb kõiki.
 * 
 * MÄRKUS: Algselt oli see leht mõeldud pending-edits ülevaatuseks
 * (contributor-rolli kasutajate muudatuste kinnitamiseks). See süsteem
 * on implementeeritud (vt server/pending_edits.py), kuid ei ole kasutusel,
 * kuna tekitab liiga suure halduskoormuse. Praegu on see leht lihtsalt
 * Git ajaloo vaatamiseks.
 */
import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router-dom';
import {
  Clock,
  User,
  FileText,
  ExternalLink,
  Loader2,
  AlertCircle,
  ChevronDown,
  ChevronRight,
  Filter,
  History,
  Plus,
  Minus
} from 'lucide-react';
import Header from '../components/Header';
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

interface DiffData {
  diff: string;
  additions: number;
  deletions: number;
  files: string[];
}

const Review: React.FC = () => {
  const { t } = useTranslation(['review', 'common']);
  const { user, authToken: token, isLoading: userLoading } = useUser();
  const navigate = useNavigate();

  const [commits, setCommits] = useState<RecentCommit[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [filterUser, setFilterUser] = useState<string | null>(null);
  const [selectedUser, setSelectedUser] = useState<string | null>(null); // null = kõik kasutajad
  const [showUserFilter, setShowUserFilter] = useState(false);
  const [expandedCommit, setExpandedCommit] = useState<string | null>(null);
  const [diffCache, setDiffCache] = useState<Record<string, DiffData>>({});
  const [loadingDiff, setLoadingDiff] = useState<string | null>(null);

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
  }, [user, token, selectedUser]);

  const loadRecentEdits = async () => {
    if (!token) return;
    
    setLoading(true);
    setError(null);

    try {
      let url = `${FILE_API_URL}/recent-edits?token=${token}&limit=50`;
      
      // Kui admin on valinud konkreetse kasutaja
      if (selectedUser) {
        url += `&user=${encodeURIComponent(selectedUser)}`;
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

  // Lae diff'i andmed lazy loading'uga
  const loadDiff = async (commit: RecentCommit) => {
    const key = commit.full_hash;
    
    // Kui juba on laetud, kasuta cache'i
    if (diffCache[key]) {
      return;
    }
    
    setLoadingDiff(key);
    
    try {
      const response = await fetch(`${FILE_API_URL}/commit-diff`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          auth_token: token,
          commit_hash: commit.full_hash,
          filepath: commit.filepath
        })
      });
      
      const data = await response.json();
      
      if (data.status === 'success') {
        setDiffCache(prev => ({
          ...prev,
          [key]: {
            diff: data.diff,
            additions: data.additions,
            deletions: data.deletions,
            files: data.files
          }
        }));
      }
    } catch (err) {
      console.error('Diff laadimine ebaõnnestus:', err);
    } finally {
      setLoadingDiff(null);
    }
  };

  // Ava/sulge diff
  const toggleDiff = (commit: RecentCommit) => {
    const key = commit.full_hash;
    if (expandedCommit === key) {
      setExpandedCommit(null);
    } else {
      setExpandedCommit(key);
      loadDiff(commit);
    }
  };

  // Parsi diff lihtsaks kuvamiseks
  const renderDiff = (diffText: string) => {
    const lines = diffText.split('\n');
    return lines.map((line, i) => {
      // Jäta vahele diff päised
      if (line.startsWith('diff --git') || 
          line.startsWith('index ') || 
          line.startsWith('---') || 
          line.startsWith('+++') ||
          line.startsWith('@@')) {
        return null;
      }
      
      let className = 'text-gray-700';
      let prefix = ' ';
      
      if (line.startsWith('+')) {
        className = 'bg-green-100 text-green-800';
        prefix = '+';
      } else if (line.startsWith('-')) {
        className = 'bg-red-100 text-red-800';
        prefix = '-';
      }
      
      return (
        <div key={i} className={`px-2 py-0.5 font-mono text-xs ${className} whitespace-pre-wrap break-all`}>
          {line}
        </div>
      );
    }).filter(Boolean);
  };

  if (!user) {
    return null;
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-primary-50 to-amber-50">
      <Header showSearchButton={false} />

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
                <div className="relative">
                  <button
                    onClick={() => setShowUserFilter(!showUserFilter)}
                    className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm transition-colors ${
                      selectedUser 
                        ? 'bg-primary-100 text-primary-700 border border-primary-200' 
                        : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                    }`}
                  >
                    <Filter size={16} />
                    {selectedUser || t('filters.all')}
                    <ChevronDown size={14} className={`transition-transform ${showUserFilter ? 'rotate-180' : ''}`} />
                  </button>
                  
                  {showUserFilter && (
                    <>
                      <div className="fixed inset-0 z-[100]" onClick={() => setShowUserFilter(false)} />
                      <div className="absolute right-0 top-full mt-1 bg-white rounded-lg shadow-lg border border-gray-200 py-1 min-w-48 z-[110] max-h-64 overflow-y-auto">
                        <button
                          onClick={() => { setSelectedUser(null); setShowUserFilter(false); }}
                          className={`flex items-center gap-2 px-4 py-2 text-sm w-full text-left ${
                            selectedUser === null ? 'bg-primary-50 text-primary-700 font-medium' : 'text-gray-700 hover:bg-gray-100'
                          }`}
                        >
                          {t('filters.all')}
                        </button>
                        <div className="border-t border-gray-100 my-1" />
                        {getUniqueAuthors().map(author => (
                          <button
                            key={author}
                            onClick={() => { setSelectedUser(author); setShowUserFilter(false); }}
                            className={`flex items-center gap-2 px-4 py-2 text-sm w-full text-left ${
                              selectedUser === author ? 'bg-primary-50 text-primary-700 font-medium' : 'text-gray-700 hover:bg-gray-100'
                            }`}
                          >
                            <div className="h-5 w-5 bg-primary-100 rounded-full flex items-center justify-center text-primary-700 font-bold text-xs flex-shrink-0">
                              {author.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase()}
                            </div>
                            {author}
                          </button>
                        ))}
                      </div>
                    </>
                  )}
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
              <div className="space-y-1">
                {/* Tabeli päis */}
                <div className="hidden sm:grid sm:grid-cols-12 gap-4 px-4 py-2 text-sm text-gray-500 font-medium border-b border-gray-200">
                  <div className="col-span-1"></div>
                  <div className="col-span-2">{t('table.when')}</div>
                  {isAdmin && !selectedUser && (
                    <div className="col-span-2">{t('table.who')}</div>
                  )}
                  <div className={isAdmin && !selectedUser ? "col-span-6" : "col-span-8"}>{t('table.where')}</div>
                  <div className="col-span-1"></div>
                </div>

                {/* Tabeli read */}
                {commits.map((commit, index) => {
                  const isExpanded = expandedCommit === commit.full_hash;
                  const diffData = diffCache[commit.full_hash];
                  const isLoadingThis = loadingDiff === commit.full_hash;
                  
                  return (
                    <div key={`${commit.commit_hash}-${index}`} className="border border-gray-100 rounded-lg overflow-hidden">
                      {/* Peamine rida */}
                      <div 
                        className={`grid grid-cols-1 sm:grid-cols-12 gap-2 sm:gap-4 px-4 py-3 hover:bg-gray-50 cursor-pointer ${isExpanded ? 'bg-gray-50' : ''}`}
                        onClick={() => toggleDiff(commit)}
                      >
                        {/* Ava/sulge nupp */}
                        <div className="col-span-1 flex items-center">
                          <button 
                            className="p-1 hover:bg-gray-200 rounded transition-colors"
                            onClick={(e) => { e.stopPropagation(); toggleDiff(commit); }}
                          >
                            {isLoadingThis ? (
                              <Loader2 size={16} className="animate-spin text-primary-600" />
                            ) : isExpanded ? (
                              <ChevronDown size={16} className="text-gray-600" />
                            ) : (
                              <ChevronRight size={16} className="text-gray-400" />
                            )}
                          </button>
                        </div>
                        
                        {/* Kuupäev */}
                        <div className="col-span-2 flex items-center gap-2 text-sm text-gray-600">
                          <Clock size={14} className="text-gray-400 hidden sm:block" />
                          <span className="sm:hidden text-xs text-gray-400">{t('table.when')}:</span>
                          {commit.formatted_date}
                        </div>
                        
                        {/* Kasutaja (ainult admin) */}
                        {isAdmin && !selectedUser && (
                          <div className="col-span-2 flex items-center gap-2">
                            <div className="h-6 w-6 bg-primary-100 rounded-full flex items-center justify-center text-primary-700 font-bold text-xs flex-shrink-0">
                              {commit.author.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase()}
                            </div>
                            <span className="text-sm text-gray-700 truncate">{commit.author}</span>
                          </div>
                        )}
                        
                        {/* Koht (teose_id + lk) */}
                        <div className={`${isAdmin && !selectedUser ? "col-span-6" : "col-span-8"} flex items-center gap-2 min-w-0`}>
                          <FileText size={14} className="text-gray-400 flex-shrink-0 hidden sm:block" />
                          <span className="text-sm font-medium text-gray-900 truncate" title={commit.teose_id}>
                            {commit.teose_id}
                          </span>
                          <span className="text-xs text-gray-500 bg-gray-100 px-1.5 py-0.5 rounded flex-shrink-0">
                            lk {commit.lehekylje_number}
                          </span>
                        </div>
                        
                        {/* Link */}
                        <div className="col-span-1 flex items-center justify-end">
                          <Link
                            to={`/work/${commit.teose_id}/${commit.lehekylje_number}`}
                            className="inline-flex items-center gap-1 p-2 text-primary-600 hover:text-primary-700 hover:bg-primary-50 rounded-lg transition-colors"
                            title={t('actions.openPage')}
                            onClick={(e) => e.stopPropagation()}
                          >
                            <ExternalLink size={18} />
                          </Link>
                        </div>
                      </div>
                      
                      {/* Avatav diff paneel */}
                      {isExpanded && (
                        <div className="border-t border-gray-200 bg-gray-50 px-4 py-3">
                          {isLoadingThis ? (
                            <div className="flex items-center gap-2 text-gray-500 py-2">
                              <Loader2 size={16} className="animate-spin" />
                              <span className="text-sm">{t('diff.loading')}</span>
                            </div>
                          ) : diffData ? (
                            <div>
                              {/* Statistika */}
                              <div className="flex items-center gap-4 mb-3 text-sm">
                                <span className="flex items-center gap-1 text-green-700">
                                  <Plus size={14} />
                                  {diffData.additions} {t('diff.additions')}
                                </span>
                                <span className="flex items-center gap-1 text-red-700">
                                  <Minus size={14} />
                                  {diffData.deletions} {t('diff.deletions')}
                                </span>
                              </div>
                              
                              {/* Diff sisu */}
                              <div className="bg-white rounded border border-gray-200 max-h-96 overflow-auto">
                                {diffData.diff ? (
                                  renderDiff(diffData.diff)
                                ) : (
                                  <div className="p-4 text-gray-500 text-sm text-center">
                                    {t('diff.empty')}
                                  </div>
                                )}
                              </div>
                            </div>
                          ) : (
                            <div className="text-gray-500 text-sm py-2">
                              {t('diff.error')}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  );
};

export default Review;
