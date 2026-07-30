import React, { useState } from 'react';
import { isAtLeast } from '../../utils/roleUtils';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
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
  Clock,
  Wrench,
  Wand2,
  Copy,
  Check,
  Link
} from 'lucide-react';
import { Page, Work } from '../../types';
import type { Collections } from '../../services/collectionService';
import type { TextAnnotation } from '../../types';
import { FILE_API_URL } from '../../config';
import { fetchWithTimeout, getAuthHeaders } from '../../utils/fetchWithTimeout';
// FILE_API_URL kasutatakse git-history ja git-restore päringutes

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
  work?: Work;
  user: any;
  authToken: string | null;
  onRestore: (content: string, textAnnotations?: TextAnnotation[] | null) => void;
  readOnly: boolean;
  handleReOcr?: () => void;
  reocrStatus?: string;
  onShareableChange?: (shareable: boolean) => void;
  collections?: Collections;
}

const HistoryTab: React.FC<HistoryTabProps> = ({
  page,
  work,
  user,
  authToken,
  onRestore,
  readOnly,
  handleReOcr,
  reocrStatus,
  onShareableChange,
  collections
}) => {
  const { t } = useTranslation(['workspace', 'common']);
  const navigate = useNavigate();

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

      const response = await fetchWithTimeout(`${FILE_API_URL}/git-history`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAuthHeaders(authToken) },
        body: JSON.stringify({
          original_path: page.original_path,
          file_name: txtFilename
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

      const response = await fetchWithTimeout(`${FILE_API_URL}/commit-diff`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAuthHeaders(authToken) },
        body: JSON.stringify({
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
    // Jagame diffi failide plokkideks
    const blocks = diffText.split('diff --git');
    const result: React.ReactNode[] = [];

    blocks.forEach((block, blockIdx) => {
      if (!block.trim()) return;

      const lines = block.split('\n');
      const isJson = block.includes('.json');
      const isTxt = block.includes('.txt');
      
      let label = isJson ? 'Märkmed ja metaandmed' : isTxt ? 'Tekstisisu' : 'Fail';
      
      const processedLines: React.ReactNode[] = [];
      let hasMeaningfulChanges = false;

      lines.forEach((line, i) => {
        const trimmedLine = line.trim();

        // 1. Filtreeri tehnilised päised ja ploki esimene rida (failitee)
        if (i === 0 || 
            trimmedLine.startsWith('index ') ||
            trimmedLine.startsWith('---') ||
            trimmedLine.startsWith('+++') ||
            trimmedLine.startsWith('@@') ||
            trimmedLine.startsWith('\\ No newline') ||
            trimmedLine.startsWith('new file mode') ||
            trimmedLine.startsWith('old file mode') ||
            trimmedLine.startsWith('a/') ||
            trimmedLine.startsWith('b/') ||
            trimmedLine === '') {
          return;
        }

        // 2. Filtreeri JSON müra (tehnilised väljad)
        const isTechField = trimmedLine.match(/^["'](updated_at|created_at|work_id|page_number|id|slug)["']\s*:/) ||
                           line.match(/^[+-]\s*["'](updated_at|created_at|work_id|page_number|id|slug)["']\s*:/);
        
        // Kas see rida on sisuline muudatus?
        const isAddition = line.startsWith('+');
        const isDeletion = line.startsWith('-');
        
        if ((isAddition || isDeletion) && !isTechField) {
          // Kontrollime, et poleks lihtsalt sulg või tühi rida
          const content = trimmedLine.substring(1).trim();
          if (content !== '' && content !== '{' && content !== '}' && content !== '[' && content !== ']' && content !== '},' && content !== '],') {
            hasMeaningfulChanges = true;
          }
        }

        if (isTechField) return;

        // Kui on JSON, peidame ka kontekstiread, mis on lihtsalt sulud või tehnilised väljad
        if (isJson && !isAddition && !isDeletion) {
          if (trimmedLine === '{' || trimmedLine === '}' || trimmedLine === '[' || trimmedLine === ']' || trimmedLine === '},' || trimmedLine === '],') {
            return;
          }
        }

        let className = 'text-gray-500 pl-4 border-l-4 border-transparent';
        if (isAddition) {
          className = 'bg-green-50 text-green-900 pl-4 border-l-4 border-green-400 py-0.5';
        } else if (isDeletion) {
          className = 'bg-red-50 text-red-900 pl-4 border-l-4 border-red-300 py-0.5';
        }

        processedLines.push(
          <div key={`${blockIdx}-${i}`} className={`font-mono text-xs whitespace-pre-wrap break-all ${className}`}>
            {line}
          </div>
        );
      });

      // Lisa faili plokk ainult siis, kui seal on reaalseid muudatusi
      if (hasMeaningfulChanges) {
        result.push(
          <div key={`block-${blockIdx}`} className="mb-6 last:mb-0">
            <div className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-2 border-b border-gray-100 pb-1">
              {label}
            </div>
            <div className="space-y-0.5">
              {processedLines}
            </div>
          </div>
        );
      }
    });

    if (result.length === 0) {
      return (
        <div className="p-4 text-center text-gray-400 italic text-sm">
          {t('history.onlyTimestampChanges')}
        </div>
      );
    }

    return result;
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

      const response = await fetchWithTimeout(`${FILE_API_URL}/git-restore`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAuthHeaders(authToken) },
        body: JSON.stringify({
          original_path: page.original_path,
          file_name: txtFilename,
          commit_hash: entry.full_hash
        }),
        timeout: 30000
      });

      const data = await response.json();
      if (data.status === 'success' && data.restored_content !== undefined) {
        onRestore(data.restored_content, data.restored_text_annotations);
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

  const isAdmin = isAtLeast(user?.role, 'admin');
  const canLoad = Date.now() - lastLoadTime >= RATE_LIMIT_MS;

  const [slugCopied, setSlugCopied] = useState(false);
  const slug = page.original_path?.replace(/^data\//, '').split('/')[0];

  // Jagamise toggle state
  const [shareable, setShareable] = useState<boolean>(work?.shareable ?? false);
  const [shareableSaving, setShareableSaving] = useState(false);
  const [linkCopied, setLinkCopied] = useState(false);
  const hasRestrictedCollection = (work?.collections || []).some(
    collectionId => collections?.[collectionId]?.visibility === 'restricted'
  );

  React.useEffect(() => {
    setShareable(work?.shareable ?? false);
  }, [work?.shareable]);

  const copySlug = () => {
    if (!slug) return;
    navigator.clipboard.writeText(slug).then(() => {
      setSlugCopied(true);
      setTimeout(() => setSlugCopied(false), 2000);
    });
  };

  const handleShareableToggle = async (newValue: boolean) => {
    if (!work?.work_id || !authToken) return;
    setShareable(newValue);
    setShareableSaving(true);
    try {
      const response = await fetchWithTimeout(`${FILE_API_URL}/work/${work.work_id}/shareable`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAuthHeaders(authToken) },
        body: JSON.stringify({ shareable: newValue }),
        timeout: 10000,
      });
      const data = await response.json();
      if (!response.ok || data.status !== 'success') {
        throw new Error(data.message || 'Jagamise oleku salvestamine ebaõnnestus');
      }
      setShareable(data.shareable);
      onShareableChange?.(data.shareable);
    } catch {
      // Taasta eelmine olek vea korral
      setShareable(!newValue);
    } finally {
      setShareableSaving(false);
    }
  };

  return (
    <div className="h-full bg-gray-50 p-6 overflow-y-auto">
      {/* Git versiooniajalugu - nähtav kõigile sisselogitud kasutajatele */}
      {user ? (
        <div className="bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden">
          <div className="flex items-center justify-between px-5 py-3 border-b border-gray-100">
            <div className="flex items-center gap-2">
              <History size={15} className="text-gray-400" />
              <span className="text-xs font-semibold uppercase tracking-wider text-gray-400">{t('history.gitHistory')}</span>
            </div>
            <button
              onClick={loadGitHistory}
              disabled={isLoadingHistory || !canLoad}
              className="text-xs px-3 py-1.5 font-medium text-gray-600 border border-gray-200 bg-gray-50 hover:bg-gray-100 disabled:opacity-50 rounded transition-colors"
              title={!canLoad ? t('history.rateLimitHint') : undefined}
            >
              {isLoadingHistory ? t('common:labels.loading') : t('history.refresh')}
            </button>
          </div>

          {gitHistory.length === 0 && !isLoadingHistory && (
            <p className="text-sm text-gray-400 text-center px-5 py-6">{t('history.emptyHistory')}</p>
          )}

          {gitHistory.length > 0 && (
            <div className="divide-y divide-gray-100">
              {gitHistory.map((entry) => {
                const isExpanded = expandedCommit === entry.full_hash;
                const diffData = diffCache[entry.full_hash];
                const isLoadingThis = loadingDiff === entry.full_hash;

                return (
                  <div
                    key={entry.full_hash}
                    className={entry.is_original ? 'bg-green-50/40' : ''}
                  >
                    {/* Peamine rida */}
                    <div
                      className={`flex items-center gap-2 px-4 py-2.5 cursor-pointer hover:bg-gray-50 ${
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
                        <Shield size={14} className="text-green-600 flex-shrink-0" aria-label={t('history.originalOCR')} />
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
                      <div className="border-t border-gray-100 bg-gray-50 px-4 py-3">
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
        <div className="bg-white rounded-lg border border-gray-200 shadow-sm px-5 py-6 text-center text-sm text-gray-400">
          {t('history.loginToView')}
        </div>
      )}

      {/* Jagamine — editor ja admin */}
      {(isAtLeast(user?.role, 'editor')) && work && hasRestrictedCollection && (
        <div className="mt-6 bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden">
          <div className="flex items-center gap-2 px-5 py-3 border-b border-gray-100">
            <Link size={15} className="text-gray-400" />
            <span className="text-xs font-semibold uppercase tracking-wider text-gray-400">{t('sharing.title')}</span>
          </div>
          <div className="px-5 py-4">
            <div className="flex items-center gap-6">
              <label className="flex items-center gap-1.5 cursor-pointer">
                <input
                  type="radio"
                  name="shareable"
                  checked={!shareable}
                  onChange={() => handleShareableToggle(false)}
                  disabled={shareableSaving}
                  className="text-primary-600"
                />
                <span className="text-sm text-gray-700">{t('sharing.private')}</span>
              </label>
              <label className="flex items-center gap-1.5 cursor-pointer">
                <input
                  type="radio"
                  name="shareable"
                  checked={shareable}
                  onChange={() => handleShareableToggle(true)}
                  disabled={shareableSaving}
                  className="text-primary-600"
                />
                <span className="text-sm text-gray-700">{t('sharing.shareable')}</span>
              </label>
              {shareableSaving && <Loader2 size={13} className="animate-spin text-gray-400" />}
            </div>
            {shareable && (
              <div className="mt-3 flex items-center gap-2">
                <code className="text-xs text-gray-500 font-mono truncate flex-1 bg-gray-50 px-2 py-1 rounded border border-gray-200">
                  {typeof window !== 'undefined' ? `${window.location.origin}/work/${work.work_id}` : ''}
                </code>
                <button
                  onClick={() => {
                    navigator.clipboard.writeText(`${window.location.origin}/work/${work.work_id}`);
                    setLinkCopied(true);
                    setTimeout(() => setLinkCopied(false), 2000);
                  }}
                  className="shrink-0 flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-gray-600 border border-gray-200 bg-gray-50 hover:bg-gray-100 rounded transition-colors"
                >
                  {linkCopied ? <Check size={12} className="text-emerald-600" /> : <Copy size={12} />}
                  {linkCopied ? t('sharing.copied') : t('sharing.copy')}
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Admin — transkriptsioon ja teose haldus */}
      {isAdmin && (
        <div className="mt-6 bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden">
          <div className="flex items-center gap-2 px-5 py-3 border-b border-gray-100">
            <Shield size={15} className="text-gray-400" />
            <span className="text-xs font-semibold uppercase tracking-wider text-gray-400">Admin</span>
          </div>

          {handleReOcr && (
            <div className="px-5 py-4 flex items-start justify-between gap-4 border-b border-gray-100 last:border-0">
              <div className="min-w-0">
                <div className="flex items-center gap-1.5 text-sm font-medium text-gray-800 mb-0.5">
                  <Wand2 size={13} className="text-emerald-600 shrink-0" />
                  {t('editor.reocr.button')}
                </div>
                <p className="text-xs text-gray-400 leading-snug">{t('editor.reocr.hint')}</p>
              </div>
              <button
                onClick={handleReOcr}
                disabled={reocrStatus !== 'idle'}
                className="shrink-0 flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-emerald-700 border border-emerald-200 bg-emerald-50 hover:bg-emerald-100 rounded transition-colors disabled:opacity-50"
              >
                {(reocrStatus === 'uploading' || reocrStatus === 'processing') && (
                  <Loader2 className="animate-spin" size={12} />
                )}
                {reocrStatus === 'uploading'
                  ? t('editor.reocr.uploading')
                  : reocrStatus === 'processing'
                    ? t('editor.reocr.processing')
                    : t('editor.reocr.button')}
              </button>
            </div>
          )}

          {slug && (
            <div className="px-5 py-4 flex items-center justify-between gap-4 border-b border-gray-100">
              <div className="min-w-0">
                <p className="text-xs text-gray-400 mb-1">{t('manage.directory')}</p>
                <code className="text-xs font-mono text-gray-700 truncate block">data/{slug}/</code>
              </div>
              <button
                onClick={copySlug}
                className="shrink-0 flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-gray-600 border border-gray-200 bg-gray-50 hover:bg-gray-100 rounded transition-colors"
              >
                {slugCopied ? <Check size={12} className="text-emerald-600" /> : <Copy size={12} />}
                {slugCopied ? 'Kopeeritud' : 'Kopeeri'}
              </button>
            </div>
          )}

          {work && (
            <div className="px-5 py-4 flex items-start justify-between gap-4 last:border-0">
              <div className="min-w-0">
                <div className="flex items-center gap-1.5 text-sm font-medium text-gray-800 mb-0.5">
                  <Wrench size={13} className="text-amber-500 shrink-0" />
                  {t('manage.manageWork')}
                </div>
                <p className="text-xs text-gray-400 leading-snug">{t('manage.managePageHint')}</p>
              </div>
              <button
                onClick={() => navigate(`/work/${work.work_id}/manage`)}
                className="shrink-0 flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-amber-700 border border-amber-200 bg-amber-50 hover:bg-amber-100 rounded transition-colors"
              >
                {t('manage.manageWork')}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default HistoryTab;
