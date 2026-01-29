import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  History,
  RotateCcw,
  Shield,
  User,
  Loader2,
  ChevronDown,
  ChevronRight,
  Plus,
  Minus,
  Clock
} from 'lucide-react';
import { Page } from '../../types';
import { FILE_API_URL } from '../../config';

// Git ajaloo kirje tüüp
interface GitHistoryEntry {
  hash: string;
  full_hash: string;
  author: string;
  date: string;
  formatted_date: string;
  message: string;
  is_original: boolean;
}

// Diff andmed
interface DiffData {
  diff: string;
  additions: number;
  deletions: number;
  files: string[];
}

interface HistoryTabProps {
  page: Page;
  user: any;
  authToken: string | null;
  onRestore: (content: string) => void;
  readOnly: boolean;
}

const HistoryTab: React.FC<HistoryTabProps> = ({
  page,
  user,
  authToken,
  onRestore,
  readOnly
}) => {
  const { t } = useTranslation(['workspace', 'common']);

  // Git ajaloo state
  const [gitHistory, setGitHistory] = useState<GitHistoryEntry[]>([]);
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);
  const [isRestoring, setIsRestoring] = useState(false);

  // Diff state (nagu Review lehel)
  const [expandedCommit, setExpandedCommit] = useState<string | null>(null);
  const [diffCache, setDiffCache] = useState<Record<string, DiffData>>({});
  const [loadingDiff, setLoadingDiff] = useState<string | null>(null);

  // Rate limit state
  const [lastLoadTime, setLastLoadTime] = useState<number>(0);
  const RATE_LIMIT_MS = 5000; // 5 sekundit

  const loadGitHistory = async () => {
    // Rate limit kontroll
    const now = Date.now();
    if (now - lastLoadTime < RATE_LIMIT_MS) {
      return;
    }

    if (!page.original_path || !page.image_url) {
      console.warn("Ei saa Git ajalugu laadida: puudub original_path või image_url");
      return;
    }

    if (!authToken) {
      alert(t('history.loginRequired'));
      return;
    }

    setIsLoadingHistory(true);
    setLastLoadTime(now);

    try {
      const imagePath = page.image_url.split('/').pop() || '';
      const txtFilename = imagePath.replace(/\.(jpg|jpeg|png|gif)$/i, '.txt');

      const response = await fetch(`${FILE_API_URL}/git-history`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          original_path: page.original_path,
          file_name: txtFilename,
          auth_token: authToken
        })
      });

      const data = await response.json();
      if (data.status === 'success') {
        setGitHistory(data.history || []);
      } else {
        console.error("Git ajaloo laadimine ebaõnnestus:", data.message);
        if (data.message?.includes('Autentimine') || data.message?.includes('parool')) {
          alert(t('history.authError'));
        }
      }
    } catch (e) {
      console.error("Git ajaloo laadimine ebaõnnestus:", e);
    } finally {
      setIsLoadingHistory(false);
    }
  };

  // Lae diff'i andmed lazy loading'uga (nagu Review lehel)
  const loadDiff = async (entry: GitHistoryEntry) => {
    const key = entry.full_hash;

    // Kui juba on laetud, kasuta cache'i
    if (diffCache[key]) {
      return;
    }

    if (!page.original_path || !page.image_url) {
      return;
    }

    setLoadingDiff(key);

    try {
      const imagePath = page.image_url.split('/').pop() || '';
      const txtFilename = imagePath.replace(/\.(jpg|jpeg|png|gif)$/i, '.txt');
      const filepath = `${page.original_path}/${txtFilename}`;

      const response = await fetch(`${FILE_API_URL}/commit-diff`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          auth_token: authToken,
          commit_hash: entry.full_hash,
          filepath: filepath
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
  const toggleDiff = (entry: GitHistoryEntry) => {
    const key = entry.full_hash;
    if (expandedCommit === key) {
      setExpandedCommit(null);
    } else {
      setExpandedCommit(key);
      loadDiff(entry);
    }
  };

  // Parsi diff lihtsaks kuvamiseks (nagu Review lehel)
  const renderDiff = (diffText: string) => {
    const lines = diffText.split('\n');
    return lines.map((line, i) => {
      // Jäta vahele diff päised ja tehniline info
      if (line.startsWith('diff --git') ||
          line.startsWith('index ') ||
          line.startsWith('---') ||
          line.startsWith('+++') ||
          line.startsWith('@@') ||
          line.startsWith('\\ No newline') ||
          line.startsWith('new file mode') ||
          line.startsWith('old file mode')) {
        return null;
      }

      let className = 'text-gray-700';

      if (line.startsWith('+')) {
        className = 'bg-green-100 text-green-800';
      } else if (line.startsWith('-')) {
        className = 'bg-red-100 text-red-800';
      }

      return (
        <div key={i} className={`px-2 py-0.5 font-mono text-xs ${className} whitespace-pre-wrap break-all`}>
          {line}
        </div>
      );
    }).filter(Boolean);
  };

  const handleGitRestore = async (entry: GitHistoryEntry) => {
    if (!page.original_path || !page.image_url) {
      alert(t('history.restoreError'));
      return;
    }

    if (!authToken) {
      alert(t('history.loginRequired'));
      return;
    }

    const confirmMsg = entry.is_original
      ? `${t('history.restoreOriginalConfirm')}\n\n${t('history.author')}: ${entry.author}\n${t('history.date')}: ${entry.formatted_date}`
      : `${t('history.restoreConfirm')}\n\n${t('history.author')}: ${entry.author}\n${t('history.date')}: ${entry.formatted_date}\n\n${t('history.restoreNote')}`;

    if (!confirm(confirmMsg)) {
      return;
    }

    setIsRestoring(true);
    try {
      const imagePath = page.image_url.split('/').pop() || '';
      const txtFilename = imagePath.replace(/\.(jpg|jpeg|png|gif)$/i, '.txt');

      const response = await fetch(`${FILE_API_URL}/git-restore`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          original_path: page.original_path,
          file_name: txtFilename,
          commit_hash: entry.full_hash,
          auth_token: authToken
        })
      });

      const data = await response.json();
      if (data.status === 'success' && data.restored_content !== undefined) {
        onRestore(data.restored_content);
        alert(`${t('history.restoreSuccess', { date: entry.formatted_date, author: entry.author })}\n\n${t('history.saveReminder')}`);
        loadGitHistory();
      } else {
        alert(`${t('history.restoreError')}: ${data.message || t('common:error.unknown')}`);
      }
    } catch (e: any) {
      console.error("Taastamine ebaõnnestus:", e);
      alert(`${t('history.restoreError')}: ${e.message || t('common:error.network')}`);
    } finally {
      setIsRestoring(false);
    }
  };

  const isAdmin = user?.role === 'admin';
  const canLoad = Date.now() - lastLoadTime >= RATE_LIMIT_MS;

  return (
    <div className="h-full bg-gray-50 p-6 overflow-y-auto">
      {/* Git versiooniajalugu - nähtav kõigile sisselogitud kasutajatele */}
      {user ? (
        <div className="bg-white p-5 rounded-lg border border-gray-200 shadow-sm">
          <div className="flex items-center justify-between mb-4 border-b border-gray-100 pb-2">
            <div className="flex items-center gap-2 text-gray-800">
              <History size={18} className="text-primary-600" />
              <h4 className="font-bold">{t('history.gitHistory')}</h4>
            </div>
            <button
              onClick={loadGitHistory}
              disabled={isLoadingHistory || !canLoad}
              className="text-xs px-3 py-1 bg-gray-100 hover:bg-gray-200 disabled:bg-gray-50 disabled:text-gray-400 rounded text-gray-700 transition-colors"
              title={!canLoad ? t('history.rateLimitHint') : undefined}
            >
              {isLoadingHistory ? t('common:labels.loading') : t('history.refresh')}
            </button>
          </div>

          {gitHistory.length === 0 && !isLoadingHistory && (
            <p className="text-sm text-gray-400 text-center py-4">{t('history.emptyHistory')}</p>
          )}

          {gitHistory.length > 0 && (
            <div className="space-y-1">
              {gitHistory.map((entry) => {
                const isExpanded = expandedCommit === entry.full_hash;
                const diffData = diffCache[entry.full_hash];
                const isLoadingThis = loadingDiff === entry.full_hash;

                return (
                  <div
                    key={entry.full_hash}
                    className={`border rounded-lg overflow-hidden ${
                      entry.is_original
                        ? 'border-green-200 bg-green-50/50'
                        : 'border-gray-200'
                    }`}
                  >
                    {/* Peamine rida */}
                    <div
                      className={`flex items-center gap-2 px-3 py-2 cursor-pointer hover:bg-gray-50 ${
                        isExpanded ? 'bg-gray-50' : ''
                      }`}
                      onClick={() => toggleDiff(entry)}
                    >
                      {/* Ava/sulge nupp */}
                      <button
                        className="p-1 hover:bg-gray-200 rounded transition-colors flex-shrink-0"
                        onClick={(e) => { e.stopPropagation(); toggleDiff(entry); }}
                      >
                        {isLoadingThis ? (
                          <Loader2 size={14} className="animate-spin text-primary-600" />
                        ) : isExpanded ? (
                          <ChevronDown size={14} className="text-gray-600" />
                        ) : (
                          <ChevronRight size={14} className="text-gray-400" />
                        )}
                      </button>

                      {/* Originaal badge */}
                      {entry.is_original && (
                        <Shield size={14} className="text-green-600 flex-shrink-0" title={t('history.originalOCR')} />
                      )}

                      {/* Kuupäev */}
                      <div className="flex items-center gap-1 text-sm text-gray-600 flex-shrink-0">
                        <Clock size={12} className="text-gray-400" />
                        {new Date(entry.date).toLocaleString('et-EE', {
                          day: '2-digit',
                          month: '2-digit',
                          year: 'numeric',
                          hour: '2-digit',
                          minute: '2-digit'
                        })}
                      </div>

                      {/* Kasutaja */}
                      <div className="flex items-center gap-1 text-sm text-gray-500 min-w-0">
                        <User size={12} className="text-gray-400 flex-shrink-0" />
                        <span className="truncate">{entry.author}</span>
                      </div>

                      {/* +/- statistika (kui diff on laetud) */}
                      {diffData && (
                        <div className="flex items-center gap-2 text-xs ml-auto flex-shrink-0">
                          <span className="flex items-center gap-0.5 text-green-700">
                            <Plus size={10} />
                            {diffData.additions}
                          </span>
                          <span className="flex items-center gap-0.5 text-red-700">
                            <Minus size={10} />
                            {diffData.deletions}
                          </span>
                        </div>
                      )}

                      {/* Originaal badge tekst */}
                      {entry.is_original && (
                        <span className="text-xs px-1.5 py-0.5 bg-green-100 text-green-700 rounded flex-shrink-0 ml-auto">
                          {t('history.original')}
                        </span>
                      )}

                      {/* Restore nupp (ainult admin) */}
                      {isAdmin && (
                        <button
                          onClick={(e) => { e.stopPropagation(); handleGitRestore(entry); }}
                          disabled={isRestoring || readOnly}
                          className={`text-xs px-2 py-1 ${
                            entry.is_original
                              ? 'bg-green-600 hover:bg-green-700'
                              : 'bg-primary-600 hover:bg-primary-700'
                          } disabled:bg-gray-300 text-white rounded transition-colors flex items-center gap-1 flex-shrink-0 ml-2`}
                          title={t('history.restore')}
                        >
                          {isRestoring ? (
                            <Loader2 size={12} className="animate-spin" />
                          ) : (
                            <RotateCcw size={12} />
                          )}
                        </button>
                      )}
                    </div>

                    {/* Avatav diff paneel */}
                    {isExpanded && (
                      <div className="border-t border-gray-200 bg-gray-50 px-3 py-2">
                        {isLoadingThis ? (
                          <div className="flex items-center gap-2 text-gray-500 py-2">
                            <Loader2 size={14} className="animate-spin" />
                            <span className="text-sm">{t('history.loadingDiff')}</span>
                          </div>
                        ) : diffData ? (
                          <div>
                            {/* Statistika */}
                            <div className="flex items-center gap-4 mb-2 text-xs">
                              <span className="flex items-center gap-1 text-green-700">
                                <Plus size={12} />
                                {diffData.additions} {t('history.additions')}
                              </span>
                              <span className="flex items-center gap-1 text-red-700">
                                <Minus size={12} />
                                {diffData.deletions} {t('history.deletions')}
                              </span>
                            </div>

                            {/* Diff sisu */}
                            <div className="bg-white rounded border border-gray-200 max-h-64 overflow-auto">
                              {diffData.diff ? (
                                renderDiff(diffData.diff)
                              ) : (
                                <div className="p-3 text-gray-500 text-sm text-center">
                                  {t('history.emptyDiff')}
                                </div>
                              )}
                            </div>
                          </div>
                        ) : (
                          <div className="text-gray-500 text-sm py-2">
                            {t('history.diffError')}
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
      ) : (
        <div className="bg-gray-100 p-4 rounded-lg text-center text-sm text-gray-500">
          {t('history.loginToView')}
        </div>
      )}
    </div>
  );
};

export default HistoryTab;
