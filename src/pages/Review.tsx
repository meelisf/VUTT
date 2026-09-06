/**
 * Review / Viimased muudatused leht
 * 
 * Näitab Git-põhiseid viimaseid muudatusi. Kasutajad näevad oma muudatusi,
 * admin näeb kõiki.
 * 
 * MÄRKUS: Algselt oli see leht mõeldud pending-edits ülevaatuseks (contributor-rolli
 * muudatuste kinnitamiseks). See süsteem ehitati ja EEMALDATI (099d0ad), sest
 * eelkinnitamine tekitas liiga suure halduskoormuse. Järelevalve käib nüüd nähtavuse
 * kaudu: vt ADR 0031 ja spekk 2026-09-04-contributor-kollektsiooni-ulatus-design.md.
 */
import React, { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { ocrErrorText } from '../utils/ocrErrorText';
import { Link, useNavigate } from 'react-router-dom';
import {
  Clock,
  User,
  FileText,
  ExternalLink,
  Loader2,
  AlertCircle,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Filter,
  History,
  Plus,
  Minus,
  Wand2,
  Library,
  CheckCircle,
  XCircle,
  UserCircle,
  Ban
} from 'lucide-react';
import Header from '../components/Header';
import { FILE_API_URL } from '../config';
import { useUser } from '../contexts/UserContext';
import { useCollection } from '../contexts/CollectionContext';
import { getCollectionColorClasses } from '../services/collectionService';
import { fetchWithTimeout, getAuthHeaders } from '../utils/fetchWithTimeout';

interface RecentCommit {
  commit_hash: string;
  full_hash: string;
  author: string;
  date: string;
  formatted_date: string;
  message: string;
  work_id: string | null;
  title: string | null;
  year: number | null;
  work_author: string | null;  // NB: 'author' on commit author
  lehekylje_number: number | null;
  filepath: string;
  change_type?: 'page' | 'metadata' | 'import' | 'person';  // 'page' = lehekülje muudatus, 'metadata' = teose metaandmete muudatus, 'import' = uus teos, 'person' = isiku muudatus
  person_id?: string | null;
  person_name?: string | null;
}

interface ReocrJob {
  job_id: string;
  work_id: string;
  slug: string;
  page_filename: string;
  page_number: number | null;
  username: string;
  status: 'uploading' | 'processing' | 'done' | 'error' | 'cancelled';
  error: string | null;
  /** Kas LOSSi koristus õnnestus. Ainult katkestatud töödel (#217). */
  remote_cleanup?: 'ok' | 'failed';
  started_at: number | null;
  finished_at: number | null;
  slow?: boolean;
  slow_since?: number | null;
  queue_ahead_pages?: number;
  title?: string;
}

interface OcrJob {
  id: string;
  type: 'upload' | 'reocr' | 'batch';
  title: string;
  slug: string;
  work_id: string | null;
  page_number: number | null;
  status_key: 'uploading' | 'processing' | 'review' | 'ready' | 'imported' | 'error';
  slow: boolean;
  started_at: number | null;
  progress: { ready: number; total: number } | null;
  link: string;
  error: string | null;
  username?: string;
  queue_ahead_pages?: number;
}

interface DiffData {
  diff: string;
  additions: number;
  deletions: number;
  files: string[];
}

const Review: React.FC = () => {
  const { t, i18n } = useTranslation(['review', 'common', 'workspace']);
  const { user, authToken: token, isLoading: userLoading } = useUser();
  // Kollektsioonivalik tuleb päisest (sama valik nagu Dashboardil) — Review
  // ei kasva oma teist rippmenüüd, aga näitab filtrit nähtavalt (vt allpool).
  const { selectedCollection, setSelectedCollection, getCollectionName, collections } = useCollection();
  const navigate = useNavigate();

  const [commits, setCommits] = useState<RecentCommit[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [selectedUser, setSelectedUser] = useState<string | null>(null); // null = kõik kasutajad
  const [showUserFilter, setShowUserFilter] = useState(false);
  const [expandedCommit, setExpandedCommit] = useState<string | null>(null);
  const [diffCache, setDiffCache] = useState<Record<string, DiffData>>({});
  const [loadingDiff, setLoadingDiff] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [offset, setOffset] = useState(0);
  const [allUsers, setAllUsers] = useState<string[]>([]);
  const [activeTab, setActiveTab] = useState<'history' | 'reocr'>('history');
  const [reocrJobs, setReocrJobs] = useState<OcrJob[]>([]);
  const [reocrLoading, setReocrLoading] = useState(false);
  const reocrPollRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [reocrLog, setReocrLog] = useState<ReocrJob[]>([]);
  const [reocrLogOffset, setReocrLogOffset] = useState(0);
  const [reocrLogHasMore, setReocrLogHasMore] = useState(false);
  const [reocrLogLoading, setReocrLogLoading] = useState(false);

  // Kontrolli ligipääsu (oota kuni kasutaja andmed on laetud)
  useEffect(() => {
    if (!userLoading && (!user || !token)) {
      navigate('/');
    }
  }, [user, token, userLoading, navigate]);

  // Lae muudatused kui kasutaja on olemas
  useEffect(() => {
    if (user && token) {
      // Kasutajafiltri vahetamine nullib nimekirja
      setCommits([]);
      setOffset(0);
      setHasMore(false);
      loadRecentEdits(0, false);
    }
  }, [user, token, selectedUser, selectedCollection]);

  // Lae kõigi kasutajate nimekiri admin jaoks
  useEffect(() => {
    if (!user || !token) return;
    fetchWithTimeout(`${FILE_API_URL}/admin/users`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...getAuthHeaders(token) },
      body: JSON.stringify({})
    })
      .then(res => res.json())
      .then(data => {
        if (data.status === 'success' && data.users) {
          const usernames = data.users.map((u: { username: string }) => u.username).sort();
          setAllUsers(usernames);
        }
      })
      .catch(() => {
        // Fallback: kasutame getUniqueAuthors() — allUsers jääb tühjaks
      });
  }, [user, token]);

  const loadReocrJobs = async (showLoader = false) => {
    if (!token || !isAdmin) return;
    if (showLoader) setReocrLoading(true);
    try {
      const res = await fetchWithTimeout(`${FILE_API_URL}/admin/ocr/jobs`, { headers: getAuthHeaders(token), timeout: 10000 });
      const data = await res.json();
      if (data.status === 'success') setReocrJobs(data.jobs);
    } catch {
      // eiramine
    } finally {
      if (showLoader) setReocrLoading(false);
    }
  };

  // Töö katkestamine (#217). Kinnitus käib rea sees — sama muster nagu
  // Manage-vaate batch-ribal; eraldi modaali see ei vääri.
  const [cancelConfirmId, setCancelConfirmId] = useState<string | null>(null);
  const [cancellingId, setCancellingId] = useState<string | null>(null);
  const [cancelError, setCancelError] = useState<string | null>(null);

  const handleCancelJob = async (jobId: string) => {
    if (!token) return;
    setCancellingId(jobId);
    setCancelError(null);
    try {
      const res = await fetchWithTimeout(`${FILE_API_URL}/admin/reocr/${jobId}`, {
        method: 'DELETE',
        headers: getAuthHeaders(token),
        timeout: 30000,   // koristus teeb SFTP-d, 10 s võib jääda napiks
      });
      if (!res.ok) throw new Error(String(res.status));
      setCancelConfirmId(null);
      await loadReocrJobs();
    } catch {
      setCancelError(jobId);
    } finally {
      setCancellingId(null);
    }
  };

  // Pollimine: laadi OCR tööd iga 4s kui tab on aktiivne või on aktiivseid töid
  useEffect(() => {
    if (!isAdmin) return;

    const hasActive = reocrJobs.some(j => j.status_key === 'uploading' || j.status_key === 'processing');
    if (activeTab !== 'reocr' && !hasActive) return;

    reocrPollRef.current = setTimeout(() => loadReocrJobs(), 4000);
    return () => { if (reocrPollRef.current) clearTimeout(reocrPollRef.current); };
  }, [reocrJobs, activeTab, isAdmin]);

  // Lae OCR tööd kui tab avatakse
  useEffect(() => {
    if (activeTab === 'reocr' && isAdmin) {
      loadReocrJobs(true);
      loadReocrLog(0, true);
    }
  }, [activeTab, isAdmin]);

  const loadReocrLog = async (fromOffset: number, reset = false) => {
    if (!token || !isAdmin) return;
    setReocrLogLoading(true);
    try {
      const res = await fetchWithTimeout(
        `${FILE_API_URL}/admin/reocr/log?offset=${fromOffset}&limit=50`,
        { headers: getAuthHeaders(token), timeout: 10000 }
      );
      const data = await res.json();
      if (data.status === 'success') {
        setReocrLog(prev => reset ? data.entries : [...prev, ...data.entries]);
        setReocrLogOffset(fromOffset + data.entries.length);
        setReocrLogHasMore(data.has_more);
      }
    } catch {
      // eiramine
    } finally {
      setReocrLogLoading(false);
    }
  };

  const loadRecentEdits = async (fromOffset: number, append: boolean) => {
    if (!token) return;

    if (append) {
      setLoadingMore(true);
    } else {
      setLoading(true);
    }
    setError(null);

    try {
      let url = `${FILE_API_URL}/recent-edits?limit=50&offset=${fromOffset}`;

      // Kui admin on valinud konkreetse kasutaja
      if (selectedUser) {
        url += `&user=${encodeURIComponent(selectedUser)}`;
      }

      // Päises valitud kollektsioon (alamkollektsioonid tulevad kaasa)
      if (selectedCollection) {
        url += `&collection=${encodeURIComponent(selectedCollection)}`;
      }

      // Git-ajaloo koostamine võib külma failisüsteemi või hõivatud threadpool'i korral
      // võtta üle fetchWithTimeout'i vaikimisi 10 sekundi.
      const response = await fetchWithTimeout(url, {
        headers: getAuthHeaders(token),
        timeout: 30000
      });
      const data = await response.json();

      if (data.status === 'success') {
        if (append) {
          setCommits(prev => [...prev, ...data.commits]);
        } else {
          setCommits(data.commits);
        }
        setIsAdmin(data.is_admin);
        setHasMore(data.has_more);
        setOffset(fromOffset + data.commits.length);
      } else {
        setError(data.message || t('error'));
      }
    } catch (err) {
      console.error('Muudatuste laadimine ebaõnnestus:', err);
      setError(t('error'));
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  };

  const handleLoadMore = () => {
    loadRecentEdits(offset, true);
  };

  // Grupeeri commitid kasutaja järgi (ainult admin jaoks)
  const getUniqueAuthors = (): string[] => {
    const authors = new Set(commits.map(c => c.author));
    return Array.from(authors).sort();
  };

  // Unikaalne võti iga muudatuse jaoks (commit + filepath)
  const getEntryKey = (commit: RecentCommit) => `${commit.full_hash}:${commit.filepath}`;

  // Lae diff'i andmed lazy loading'uga
  const loadDiff = async (commit: RecentCommit) => {
    const key = getEntryKey(commit);

    // Kui juba on laetud, kasuta cache'i
    if (diffCache[key]) {
      return;
    }

    setLoadingDiff(key);
    
    try {
      const response = await fetchWithTimeout(`${FILE_API_URL}/commit-diff`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAuthHeaders(token) },
        body: JSON.stringify({
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
    const key = getEntryKey(commit);
    if (expandedCommit === key) {
      setExpandedCommit(null);
    } else {
      setExpandedCommit(key);
      loadDiff(commit);
    }
  };

  // Parsi diff lihtsaks kuvamiseks
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
          {t('workspace:history.onlyTimestampChanges')}
        </div>
      );
    }

    return result;
  };

  if (!user) {
    return null;
  }

  // Kulunud aeg minutites aktiivsele tööle (elav — uueneb polli-renderdusel iga 4s)
  const formatElapsed = (startedAt: number | null): string => {
    if (!startedAt) return '';
    const mins = Math.floor((Date.now() / 1000 - startedAt) / 60);
    return mins < 1 ? t('reocr.elapsedLtMin') : t('reocr.elapsedMin', { mins });
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-primary-50 to-amber-50">
      <Header />

      {/* Main content */}
      <main className="max-w-5xl mx-auto px-4 py-8">
        {isAdmin && (
          <Link to="/admin" className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700 mb-6">
            <ChevronLeft size={16} />
            Admin
          </Link>
        )}
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

              {/* Filter (ainult admin, ainult history tabis) */}
              {isAdmin && activeTab === 'history' && (
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
                        {(allUsers.length > 0 ? allUsers : getUniqueAuthors()).map(author => (
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

          {/* Tab bar (ainult adminile) */}
          {isAdmin && (
            <div className="flex border-b border-gray-200 px-6">
              <button
                onClick={() => setActiveTab('history')}
                className={`flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
                  activeTab === 'history'
                    ? 'border-primary-600 text-primary-700'
                    : 'border-transparent text-gray-500 hover:text-gray-700'
                }`}
              >
                <History size={15} />
                {t('tabs.history')}
              </button>
              <button
                onClick={() => setActiveTab('reocr')}
                className={`flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
                  activeTab === 'reocr'
                    ? 'border-primary-600 text-primary-700'
                    : 'border-transparent text-gray-500 hover:text-gray-700'
                }`}
              >
                <Wand2 size={15} />
                {t('tabs.reocr')}
                {reocrJobs.filter(j => j.status_key === 'uploading' || j.status_key === 'processing').length > 0 && (
                  <span className="ml-1 bg-amber-100 text-amber-700 text-xs font-bold px-1.5 py-0.5 rounded-full">
                    {reocrJobs.filter(j => j.status_key === 'uploading' || j.status_key === 'processing').length}
                  </span>
                )}
              </button>
            </div>
          )}

          {/* Content */}
          <div className="p-6">
            {/* Nähtav kollektsioonifilter: päises tehtud valik ei tohi siin
                vaikselt mõjuda — üks klõps viib tagasi kõigi tööde peale. */}
            {activeTab === 'history' && selectedCollection && collections[selectedCollection] && (() => {
              const colorClasses = getCollectionColorClasses(collections[selectedCollection]);
              return (
                <div className={`mb-4 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border px-4 py-2.5 text-sm ${colorClasses.bg} ${colorClasses.border}`}>
                  <Library size={16} className={colorClasses.text} />
                  <span className={`font-medium ${colorClasses.text}`}>
                    {getCollectionName(selectedCollection, i18n.language === 'en' ? 'en' : 'et')}
                  </span>
                  <span className="text-gray-500">{t('collectionFilter.personsHidden')}</span>
                  <button
                    onClick={() => setSelectedCollection(null)}
                    className="ml-auto text-primary-700 hover:text-primary-800 underline underline-offset-2"
                  >
                    {t('common:collections.all')}
                  </button>
                </div>
              );
            })()}
            {activeTab === 'reocr' ? (
              /* OCR tööde tab */
              <>
              {reocrLoading ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="animate-spin text-primary-600" size={32} />
                  <span className="ml-3 text-gray-600">{t('reocr.loading')}</span>
                </div>
              ) : reocrJobs.length === 0 ? (
                <div className="text-center py-12">
                  <Wand2 className="mx-auto text-gray-300" size={48} />
                  <p className="mt-4 text-gray-500">{t('reocr.empty')}</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {[...reocrJobs].sort((a, b) => (b.started_at ?? 0) - (a.started_at ?? 0)).map(job => {
                    const isActive = job.status_key === 'uploading' || job.status_key === 'processing';
                    const isSlow = isActive && job.slow;
                    const isError = job.status_key === 'error';
                    return (
                      <div key={job.id}
                        className={`flex items-center gap-4 px-4 py-3 rounded-lg border ${
                          isActive ? 'border-amber-200 bg-amber-50' :
                          isError ? 'border-red-200 bg-red-50' : 'border-green-200 bg-green-50'
                        }`}>
                        {/* Staatus ikoon */}
                        <div className="shrink-0">
                          {isActive ? <Loader2 size={18} className="animate-spin text-amber-600" />
                            : isError ? <XCircle size={18} className="text-red-500" />
                            : <CheckCircle size={18} className="text-green-600" />}
                        </div>

                        {/* Info */}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-[10px] font-semibold uppercase px-1.5 py-0.5 rounded bg-gray-100 text-gray-500">
                              {t(`ocr.type.${job.type}`)}
                            </span>
                            <span className="font-medium text-gray-800 text-sm">{job.title || job.slug}</span>
                            {job.title && <span className="text-xs text-gray-400 font-mono" title={job.slug}>{job.slug}</span>}
                            {job.page_number && <span className="text-xs text-gray-500">lk {job.page_number}</span>}
                            {job.progress && <span className="text-xs text-gray-500">{job.progress.ready}/{job.progress.total} lk</span>}
                            {job.work_id && (
                              <Link to={job.link}
                                className="text-xs text-primary-600 hover:underline flex items-center gap-0.5">
                                <ExternalLink size={11} />
                              </Link>
                            )}
                            {isActive && !!job.queue_ahead_pages && job.queue_ahead_pages > 0 && (
                              <span className="text-xs text-gray-400">
                                {t('reocr.queueAhead', { count: job.queue_ahead_pages })}
                              </span>
                            )}
                          </div>
                          {job.error && (
                            <p className="text-xs text-red-600 mt-0.5">
                              {ocrErrorText(job.error, t)}
                            </p>
                          )}
                        </div>

                        {/* Kasutaja + aeg */}
                        <div className="text-xs text-gray-500 text-right shrink-0">
                          {job.username && (
                            <div className="flex items-center gap-1 justify-end">
                              <User size={11} />
                              {job.username}
                            </div>
                          )}
                          {job.started_at && (
                            <div className="flex items-center gap-1 justify-end mt-0.5">
                              <Clock size={11} />
                              {isActive ? formatElapsed(job.started_at)
                                : new Date(job.started_at * 1000).toLocaleTimeString('et-EE', { hour: '2-digit', minute: '2-digit' })}
                            </div>
                          )}
                        </div>

                        {/* Staatus badge — avaneb SAMAS tabis (react-routeri klient-nav):
                            säilitab auth-state, väldib värske tabi auth-re-initi ja
                            "logi sisse" vilkumist restricted-teosel. ↗-ikoon (üleval) jääb
                            uue-tabi valikuks. */}
                        {job.link ? (
                          <Link to={job.link}
                            className={`shrink-0 text-xs font-medium px-2 py-1 rounded ${
                              isSlow ? 'bg-amber-100 text-amber-800' :
                              isActive ? 'bg-amber-100 text-amber-700' :
                              isError ? 'bg-red-100 text-red-700' : 'bg-green-100 text-green-700'
                            }`}>
                            {isSlow ? t('reocr.slow') : t(`ocr.statusKey.${job.status_key}`)}
                          </Link>
                        ) : (
                          <span className={`shrink-0 text-xs font-medium px-2 py-1 rounded ${
                            isSlow ? 'bg-amber-100 text-amber-800' :
                            isActive ? 'bg-amber-100 text-amber-700' :
                            isError ? 'bg-red-100 text-red-700' : 'bg-green-100 text-green-700'
                          }`}>
                            {isSlow ? t('reocr.slow') : t(`ocr.statusKey.${job.status_key}`)}
                          </span>
                        )}

                        {/* Katkestamine ainult re-OCR töödel (#217): upload'i
                            viisardil on oma katkestamine ja oma endpoint. */}
                        {isActive && job.type !== 'upload' && (
                          cancelConfirmId === job.id ? (
                            <div className="flex shrink-0 items-center gap-1.5">
                              <button
                                type="button"
                                onClick={() => handleCancelJob(job.id)}
                                disabled={cancellingId === job.id}
                                title={t('reocr.cancelConfirm')}
                                className="rounded bg-red-600 px-2 py-1 text-xs font-medium text-white hover:bg-red-700 disabled:opacity-50"
                              >
                                {cancellingId === job.id
                                  ? t('reocr.cancelling')
                                  : t('reocr.cancelConfirmYes')}
                              </button>
                              <button
                                type="button"
                                onClick={() => setCancelConfirmId(null)}
                                className="rounded border border-gray-300 px-2 py-1 text-xs hover:bg-gray-100"
                              >
                                {t('common:buttons.cancel')}
                              </button>
                            </div>
                          ) : (
                            <button
                              type="button"
                              data-testid={`cancel-job-${job.id}`}
                              onClick={() => setCancelConfirmId(job.id)}
                              title={t('reocr.cancelJob')}
                              className="shrink-0 rounded border border-gray-300 p-1.5 text-gray-500 hover:bg-red-50 hover:text-red-600"
                            >
                              <Ban size={14} />
                            </button>
                          )
                        )}

                        {cancelError === job.id && (
                          <span className="shrink-0 text-xs text-red-600">
                            {t('reocr.cancelFailed')}
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Ajalugu */}

              {isAdmin && (
                <div className="mt-8">
                  <h3 className="text-sm font-semibold text-gray-600 mb-3 flex items-center gap-2">
                    <History size={14} />
                    {t('reocr.logTitle')}
                  </h3>
                  {reocrLog.length === 0 && !reocrLogLoading ? (
                    <p className="text-sm text-gray-400">{t('reocr.logEmpty')}</p>
                  ) : (
                    <div className="space-y-1.5">
                      {reocrLog.map(entry => (
                        <div
                          key={entry.job_id}
                          className={`flex items-center gap-4 px-4 py-2.5 rounded-lg border text-sm ${
                            entry.status === 'done' ? 'border-green-100 bg-green-50/50' :
                            entry.status === 'cancelled' ? 'border-gray-200 bg-gray-50' :
                            'border-red-100 bg-red-50/50'
                          }`}
                        >
                          {/* Katkestatud töö EI OLE viga — hall, mitte punane (#217) */}
                          <div className="shrink-0">
                            {entry.status === 'done'
                              ? <CheckCircle size={15} className="text-green-500" />
                              : entry.status === 'cancelled'
                              ? <Ban size={15} className="text-gray-400" />
                              : <XCircle size={15} className="text-red-400" />}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="text-gray-700">{entry.title || entry.slug}</span>
                              {entry.title && <span className="text-xs text-gray-400 font-mono" title={entry.slug}>{entry.slug}</span>}
                              {entry.page_number && <span className="text-xs text-gray-400">lk {entry.page_number}</span>}
                              {entry.work_id && (
                                <Link to={entry.page_number ? `/work/${entry.work_id}/${entry.page_number}` : `/work/${entry.work_id}`}
                                  className="text-xs text-primary-600 hover:underline flex items-center gap-0.5">
                                  <ExternalLink size={11} />
                                </Link>
                              )}
                            </div>
                            {entry.error && (
                              <p className="text-xs text-red-500 mt-0.5">
                                {ocrErrorText(entry.error, t)}
                              </p>
                            )}
                          </div>
                          <div className="text-xs text-gray-400 text-right shrink-0">
                            <div className="flex items-center gap-1 justify-end">
                              <User size={11} />{entry.username}
                            </div>
                            {entry.finished_at && (
                              <div className="flex items-center gap-1 mt-0.5 justify-end">
                                <Clock size={11} />
                                {new Date(entry.finished_at * 1000).toLocaleString('et-EE', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}
                              </div>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                  {reocrLogHasMore && (
                    <button
                      onClick={() => loadReocrLog(reocrLogOffset)}
                      disabled={reocrLogLoading}
                      className="mt-4 w-full py-2 text-sm text-gray-500 hover:text-gray-700 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors disabled:opacity-50"
                    >
                      {reocrLogLoading ? <Loader2 size={14} className="animate-spin mx-auto" /> : t('reocr.logLoadMore')}
                    </button>
                  )}
                </div>
              )}
              </>
            ) : loading ? (
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
                  {selectedUser
                    ? (selectedCollection ? t('emptyForUserCollection', { user: selectedUser }) : t('emptyForUser', { user: selectedUser }))
                    : selectedCollection
                      ? (isAdmin ? t('emptyCollection') : t('emptyUserCollection'))
                      : (isAdmin ? t('empty') : t('emptyUser'))}
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
                {commits.map((commit) => {
                  const entryKey = getEntryKey(commit);
                  const isExpanded = expandedCommit === entryKey;
                  const diffData = diffCache[entryKey];
                  const isLoadingThis = loadingDiff === entryKey;

                  return (
                    <div key={entryKey} className="border border-gray-100 rounded-lg overflow-hidden">
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
                          {new Date(commit.date).toLocaleString('et-EE', {
                            day: '2-digit',
                            month: '2-digit',
                            year: 'numeric',
                            hour: '2-digit',
                            minute: '2-digit'
                          })}
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
                        
                        {/* Teos VÕI isik */}
                        <div className={`${isAdmin && !selectedUser ? "col-span-6" : "col-span-8"} flex items-center gap-2 min-w-0`}>
                          {commit.change_type === 'person'
                            ? <UserCircle size={14} className="text-indigo-400 flex-shrink-0 hidden sm:block" />
                            : <FileText size={14} className="text-gray-400 flex-shrink-0 hidden sm:block" />
                          }

                          {commit.change_type === 'person' ? (
                            <>
                              <span className="text-sm text-gray-700 truncate">{commit.person_name || commit.message}</span>
                              {commit.message.startsWith('Prosopo loomine:') && (
                                <span className="text-xs text-green-700 bg-green-100 px-1.5 py-0.5 rounded flex-shrink-0">{t('changeType.personCreated')}</span>
                              )}
                              {commit.message.startsWith('Prosopo muudatus:') && (
                                <span className="text-xs text-gray-500 bg-gray-100 px-1.5 py-0.5 rounded flex-shrink-0">{t('changeType.person')}</span>
                              )}
                              {commit.message.startsWith('Prosopo kustutamine:') && (
                                <span className="text-xs text-red-700 bg-red-100 px-1.5 py-0.5 rounded flex-shrink-0">{t('changeType.personDeleted')}</span>
                              )}
                              {commit.message.startsWith('Prosopo liitmine:') && (
                                <span className="text-xs text-purple-700 bg-purple-100 px-1.5 py-0.5 rounded flex-shrink-0">{t('changeType.personMerged')}</span>
                              )}
                              {commit.message.startsWith('Prosopo taastamine:') && (
                                <span className="text-xs text-blue-700 bg-blue-100 px-1.5 py-0.5 rounded flex-shrink-0">{t('changeType.personRestored')}</span>
                              )}
                              {commit.message.startsWith('Prosopo migratsioon:') && (
                                <span className="text-xs text-gray-500 bg-gray-100 px-1.5 py-0.5 rounded flex-shrink-0">{t('changeType.personMigrated')}</span>
                              )}
                            </>
                          ) : (
                            <>
                              <span className="text-xs text-gray-500 font-mono flex-shrink-0">{commit.year || '?'}</span>
                              {commit.work_author && (
                                <span className="text-sm text-gray-700 flex-shrink-0 max-w-40 truncate" title={commit.work_author}>
                                  {commit.work_author}
                                </span>
                              )}
                              {commit.title && (
                                <span className="text-sm text-gray-500 truncate" title={commit.title}>
                                  {commit.title.length > 20 ? commit.title.slice(0, 20) + '…' : commit.title}
                                </span>
                              )}
                              {commit.change_type === 'import' ? (
                                <span className="text-xs text-green-700 bg-green-100 px-1.5 py-0.5 rounded flex-shrink-0">
                                  {t('changeType.import', 'Uus teos')}
                                </span>
                              ) : commit.change_type === 'metadata' ? (
                                <span className="text-xs text-amber-700 bg-amber-100 px-1.5 py-0.5 rounded flex-shrink-0">
                                  {t('changeType.metadata', 'Metaandmed')}
                                </span>
                              ) : (
                                <span className="text-xs text-gray-500 bg-gray-100 px-1.5 py-0.5 rounded flex-shrink-0">
                                  lk {commit.lehekylje_number}
                                </span>
                              )}
                            </>
                          )}
                        </div>

                        {/* Link */}
                        <div className="col-span-1 flex items-center justify-end">
                          {commit.change_type === 'person' && commit.person_id ? (
                            <Link
                              to={`/persons/${commit.person_id}`}
                              className="inline-flex items-center gap-1 p-2 text-indigo-600 hover:text-indigo-700 hover:bg-indigo-50 rounded-lg transition-colors"
                              title={t('actions.openPerson')}
                              onClick={(e) => e.stopPropagation()}
                            >
                              <ExternalLink size={18} />
                            </Link>
                          ) : commit.work_id ? (
                            <Link
                              to={commit.change_type === 'metadata' || commit.change_type === 'import'
                                ? `/work/${commit.work_id}/1`
                                : `/work/${commit.work_id}/${commit.lehekylje_number}`}
                              className="inline-flex items-center gap-1 p-2 text-primary-600 hover:text-primary-700 hover:bg-primary-50 rounded-lg transition-colors"
                              title={commit.change_type === 'metadata' || commit.change_type === 'import' ? t('actions.openWork', 'Ava teos') : t('actions.openPage')}
                              onClick={(e) => e.stopPropagation()}
                            >
                              <ExternalLink size={18} />
                            </Link>
                          ) : null}
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

                {/* "Laadi veel" nupp */}
                {hasMore && (
                  <div className="pt-4 flex justify-center">
                    <button
                      onClick={handleLoadMore}
                      disabled={loadingMore}
                      className="flex items-center gap-2 px-6 py-2.5 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg text-sm font-medium transition-colors disabled:opacity-50"
                    >
                      {loadingMore ? (
                        <>
                          <Loader2 size={16} className="animate-spin" />
                          {t('loadingMore')}
                        </>
                      ) : (
                        t('loadMore')
                      )}
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  );
};

export default Review;
