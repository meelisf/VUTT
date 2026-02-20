/**
 * Upload leht — admin teose lisamine PDF-ist OCR kaudu.
 *
 * Etapp 3: samm-sammuline viisard (metaandmed → üleslaadimine → ülevaatus).
 * Etapp 4 lisab: "Impordi" nupuks backend logika.
 */
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import {
  Upload as UploadIcon,
  FileUp,
  CheckCircle,
  Clock,
  Loader2,
  Trash2,
  AlertTriangle,
  X,
  RotateCcw,
} from 'lucide-react';
import Header from '../components/Header';
import { FILE_API_URL } from '../config';
import { useUser } from '../contexts/UserContext';
import { useCollection } from '../contexts/CollectionContext';
import { fetchWithTimeout } from '../utils/fetchWithTimeout';

// ---------------------------------------------------------------------------
// Tüübid
// ---------------------------------------------------------------------------

interface FileEntry {
  page: number;
  filename: string;
  has_ocr: boolean;
  deleted: boolean;
}

interface PollResult {
  status: string;
  ready: number;
  total: number;
  expected_pages: number | null;
  files: FileEntry[];
  progress?: { bytes_sent: number; bytes_total: number; error?: string | null };
  error?: string;
}

interface SavedUpload {
  id: string;
  status: string;
  meta: { title: string; year: string; slug: string };
  created_at: string;
  expected_pages: number | null;
  files: FileEntry[];
}

const POLL_SLOW_MS = 5000;
const POLL_FAST_MS = 2000;
const OCR_TIMEOUT_MS = 2 * 60 * 60 * 1000; // 2 tundi

// ---------------------------------------------------------------------------
// Slug utiliit (peegeldab serveri sanitize_slug)
// ---------------------------------------------------------------------------
function sanitizeSlug(text: string): string {
  return (
    text
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'teos'
  );
}

// ---------------------------------------------------------------------------
// Komponendid
// ---------------------------------------------------------------------------

/** Sammuindikaator ülaosas */
const StepIndicator: React.FC<{ step: 1 | 2 | 3; labels: [string, string, string] }> = ({
  step,
  labels,
}) => (
  <div className="flex items-center gap-0 mb-8">
    {labels.map((label, i) => {
      const num = (i + 1) as 1 | 2 | 3;
      const active = num === step;
      const done = num < step;
      return (
        <React.Fragment key={num}>
          <div className="flex items-center gap-2">
            <div
              className={`w-7 h-7 rounded-full flex items-center justify-center text-sm font-bold border-2 transition-colors ${
                done
                  ? 'bg-green-500 border-green-500 text-white'
                  : active
                  ? 'bg-primary-600 border-primary-600 text-white'
                  : 'bg-white border-gray-300 text-gray-400'
              }`}
            >
              {done ? <CheckCircle size={14} /> : num}
            </div>
            <span
              className={`text-sm font-medium ${
                active ? 'text-primary-700' : done ? 'text-green-600' : 'text-gray-400'
              }`}
            >
              {label}
            </span>
          </div>
          {i < 2 && <div className="flex-1 h-0.5 bg-gray-200 mx-3" />}
        </React.Fragment>
      );
    })}
  </div>
);

/** Ühe lehe pisipilt ülevaatuse ruudustikus */
const ThumbCard: React.FC<{
  entry: FileEntry;
  uploadId: string;
  authToken: string;
  onDelete: (page: number, filename: string) => void;
  onRestore: (page: number, filename: string) => void;
  t: (key: string) => string;
}> = ({ entry, uploadId, authToken, onDelete, onRestore, t }) => {
  const thumbUrl = `${FILE_API_URL}/admin/upload/${uploadId}/thumb/${entry.page}?token=${authToken}`;

  return (
    <div
      className={`relative rounded-lg overflow-hidden border-2 transition-all ${
        entry.deleted
          ? 'border-red-300 opacity-50'
          : entry.has_ocr
          ? 'border-green-400'
          : 'border-yellow-300'
      }`}
    >
      {/* Pisipilt */}
      <div className="aspect-[3/4] bg-gray-100 flex items-center justify-center overflow-hidden">
        {entry.has_ocr ? (
          <img
            src={thumbUrl}
            alt={`Lk ${entry.page}`}
            className="w-full h-full object-contain"
            loading="lazy"
          />
        ) : (
          <Loader2 size={24} className="text-yellow-500 animate-spin" />
        )}
      </div>

      {/* Staatusriba */}
      <div
        className={`px-2 py-1 text-xs font-medium flex items-center justify-between ${
          entry.deleted
            ? 'bg-red-50 text-red-600'
            : entry.has_ocr
            ? 'bg-green-50 text-green-700'
            : 'bg-yellow-50 text-yellow-700'
        }`}
      >
        <span>Lk {entry.page}</span>
        <span>
          {entry.deleted
            ? t('step3.deleted')
            : entry.has_ocr
            ? t('step3.ocrReady')
            : t('step3.ocrProcessing')}
        </span>
      </div>

      {/* Kustuta / Taasta nupp */}
      <button
        onClick={() =>
          entry.deleted
            ? onRestore(entry.page, entry.filename)
            : onDelete(entry.page, entry.filename)
        }
        className={`absolute top-1 right-1 p-1 rounded-full shadow text-white transition-colors ${
          entry.deleted
            ? 'bg-gray-500 hover:bg-gray-600'
            : 'bg-red-500 hover:bg-red-600'
        }`}
        title={entry.deleted ? t('step3.restore') : t('step3.delete')}
      >
        {entry.deleted ? <RotateCcw size={12} /> : <X size={12} />}
      </button>
    </div>
  );
};

// ---------------------------------------------------------------------------
// Peakomponent
// ---------------------------------------------------------------------------

const Upload: React.FC = () => {
  const { t, i18n } = useTranslation(['upload', 'common']);
  const { user, authToken, isLoading: authLoading } = useUser();
  const { collections } = useCollection();
  const navigate = useNavigate();
  const lang = (i18n.language as 'et' | 'en') || 'et';

  // --- Samm ja upload olek ---
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [uploadId, setUploadId] = useState<string | null>(null);
  const [pollResult, setPollResult] = useState<PollResult | null>(null);

  // --- Pooleliolevad üleslaadimised ---
  const [pendingUploads, setPendingUploads] = useState<SavedUpload[]>([]);
  const [loadingPending, setLoadingPending] = useState(true);

  // --- Samm 1 vorm ---
  const [title, setTitle] = useState('');
  const [year, setYear] = useState('');
  const [slug, setSlug] = useState('');
  const [slugManual, setSlugManual] = useState(false);
  const [slugConflict, setSlugConflict] = useState(false);
  const [selectedCollection, setSelectedCollection] = useState('');
  const [step1Loading, setStep1Loading] = useState(false);
  const [step1Error, setStep1Error] = useState('');

  // --- Samm 2 ---
  const [dragging, setDragging] = useState(false);
  const [uploadError, setUploadError] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  // --- Samm 3 ---
  const [localDeleted, setLocalDeleted] = useState<Set<number>>(new Set());
  const [importLoading, setImportLoading] = useState(false);
  const [importError, setImportError] = useState('');
  const [ocrStartedAt, setOcrStartedAt] = useState<number | null>(null);

  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ---------------------------------------------------------------------------
  // Auth redirect — oota async initAuth() lõppu enne suunamist
  // ---------------------------------------------------------------------------
  useEffect(() => {
    if (authLoading) return;
    if (!user || user.role !== 'admin') navigate('/');
  }, [user, navigate, authLoading]);

  // ---------------------------------------------------------------------------
  // Laadi pooleliolevad üleslaadimised
  // ---------------------------------------------------------------------------
  useEffect(() => {
    if (!authToken) return;
    fetchWithTimeout(`${FILE_API_URL}/admin/uploads?token=${authToken}`)
      .then((r) => r.json())
      .then((d) => setPendingUploads(d.uploads || []))
      .catch(() => {})
      .finally(() => setLoadingPending(false));
  }, [authToken]);

  // ---------------------------------------------------------------------------
  // Slug auto-genereerimine pealkirjast
  // ---------------------------------------------------------------------------
  useEffect(() => {
    if (!slugManual) setSlug(sanitizeSlug((year ? year + '-' : '') + title));
  }, [title, year, slugManual]);

  useEffect(() => {
    setSlugConflict(false);
    setStep1Error('');
  }, [slug, year]);

  // ---------------------------------------------------------------------------
  // Polling
  // ---------------------------------------------------------------------------
  const stopPolling = useCallback(() => {
    if (pollTimerRef.current) {
      clearInterval(pollTimerRef.current);
      pollTimerRef.current = null;
    }
  }, []);

  const startPolling = useCallback(
    (id: string, intervalMs = POLL_SLOW_MS) => {
      stopPolling();
      pollTimerRef.current = setInterval(async () => {
        if (!authToken) return;
        try {
          const r = await fetchWithTimeout(
            `${FILE_API_URL}/admin/upload/${id}/status?token=${authToken}`
          );
          if (!r.ok) return;
          const d: PollResult = await r.json();
          setPollResult(d);

          // Liigu samm 3-sse kui OCR hakkab tööle
          if (['processing', 'reviewing', 'done'].includes(d.status)) {
            setStep(3);
            if (ocrStartedAt === null) setOcrStartedAt(Date.now());
          }

          // Peata polling kui valmis
          if (['done', 'error', 'imported'].includes(d.status)) {
            stopPolling();
          }
        } catch {
          // Ignoreerime ajutisi võrgu vigu
        }
      }, intervalMs);
    },
    [authToken, stopPolling, ocrStartedAt]
  );

  useEffect(() => () => stopPolling(), [stopPolling]);

  // ---------------------------------------------------------------------------
  // Samm 1 — staging loomine
  // ---------------------------------------------------------------------------
  async function handleStep1Submit() {
    if (!title.trim() || !year.trim() || !authToken) return;
    setStep1Loading(true);
    setStep1Error('');
    setSlugConflict(false);
    try {
      const r = await fetchWithTimeout(`${FILE_API_URL}/admin/upload/create`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          auth_token: authToken,
          title: title.trim(),
          year: year.trim(),
          slug,
          collection: selectedCollection || undefined,
        }),
      });
      const d = await r.json();
      if (!r.ok) {
        if (d.conflict) {
          setSlugConflict(true);
          setStep1Error(
            t('step1.slugConflict').replace('{{slug}}', slug)
          );
        } else {
          setStep1Error(d.message || t('errors.createFailed'));
        }
        return;
      }
      setUploadId(d.upload.id);
      setStep(2);
    } catch {
      setStep1Error(t('errors.networkError'));
    } finally {
      setStep1Loading(false);
    }
  }

  // ---------------------------------------------------------------------------
  // Samm 2 — faili üleslaadimine
  // ---------------------------------------------------------------------------
  async function handleFileUpload(file: File) {
    if (!uploadId || !authToken) return;
    setUploadError('');

    // Näita kohe laadimise indikaatorit (polling pole veel vastanud)
    setPollResult((prev) => ({
      ready: 0, total: 0, expected_pages: null, files: [],
      ...(prev ?? {}),
      status: 'uploading',
    }));

    // Alusta kiire pollinguga saatmise ajaks
    startPolling(uploadId, POLL_FAST_MS);

    try {
      const r = await fetchWithTimeout(
        `${FILE_API_URL}/admin/upload/${uploadId}/files?token=${authToken}`,
        {
          method: 'POST',
          headers: { 'X-Filename': encodeURIComponent(file.name) },
          body: file,
          timeout: 300_000, // 5 min suurtele failidele
        }
      );
      const d = await r.json();
      if (!r.ok) {
        setUploadError(d.message || t('errors.uploadFailed'));
        stopPolling();
      }
      // 202 — SFTP transfer algas taustal, polling jätkab
    } catch {
      setUploadError(t('errors.uploadFailed'));
      stopPolling();
    }
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFileUpload(file);
  }

  // ---------------------------------------------------------------------------
  // Samm 3 — lehe kustutamine / taastamine
  // ---------------------------------------------------------------------------
  async function handleDeletePage(page: number, filename: string) {
    if (!uploadId || !authToken) return;
    setLocalDeleted((prev) => new Set(prev).add(page));
    await fetchWithTimeout(`${FILE_API_URL}/admin/upload/${uploadId}/delete-page`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ auth_token: authToken, filename }),
    }).catch(() => {});
  }

  async function handleRestorePage(page: number, filename: string) {
    if (!uploadId || !authToken) return;
    setLocalDeleted((prev) => {
      const s = new Set(prev);
      s.delete(page);
      return s;
    });
    await fetchWithTimeout(`${FILE_API_URL}/admin/upload/${uploadId}/delete-page`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ auth_token: authToken, filename, deleted: false }),
    }).catch(() => {});
  }

  // ---------------------------------------------------------------------------
  // Import (etapp 4 implementeerib backend — praegu placeholder)
  // ---------------------------------------------------------------------------
  async function handleImport() {
    if (!uploadId || !authToken) return;
    setImportLoading(true);
    setImportError('');
    try {
      const r = await fetchWithTimeout(
        `${FILE_API_URL}/admin/upload/${uploadId}/import`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ auth_token: authToken }),
          timeout: 60_000,
        }
      );
      const d = await r.json();
      if (!r.ok) {
        setImportError(d.message || t('step3.importError'));
        return;
      }
      stopPolling();
      // Suuna tööle
      navigate(`/work/${d.work_id}`);
    } catch {
      setImportError(t('step3.importError'));
    } finally {
      setImportLoading(false);
    }
  }

  // ---------------------------------------------------------------------------
  // Tühistamine
  // ---------------------------------------------------------------------------
  async function handleCancel() {
    if (!window.confirm(t('cancelConfirm'))) return;
    stopPolling();
    if (uploadId && authToken) {
      await fetchWithTimeout(`${FILE_API_URL}/admin/upload/${uploadId}?token=${authToken}`, {
        method: 'DELETE',
      }).catch(() => {});
    }
    setUploadId(null);
    setStep(1);
    setPollResult(null);
    setTitle('');
    setYear('');
    setSlug('');
    setSlugManual(false);
    setLocalDeleted(new Set());
    setOcrStartedAt(null);
  }

  // ---------------------------------------------------------------------------
  // Poolelioleva üleslaadimise jätkamine
  // ---------------------------------------------------------------------------
  function handleResume(saved: SavedUpload) {
    setUploadId(saved.id);
    setTitle(saved.meta.title);
    setYear(saved.meta.year);
    setSlug(saved.meta.slug);
    setSlugManual(true);

    const poll: PollResult = {
      status: saved.status,
      ready: saved.files.filter((f) => f.has_ocr && !f.deleted).length,
      total: saved.files.length,
      expected_pages: saved.expected_pages,
      files: saved.files,
    };
    setPollResult(poll);
    setLocalDeleted(new Set(saved.files.filter((f) => f.deleted).map((f) => f.page)));

    if (['reviewing', 'done', 'processing'].includes(saved.status)) {
      setStep(3);
      setOcrStartedAt(Date.now() - POLL_SLOW_MS); // Eeldame et on juba alustanud
      startPolling(saved.id, POLL_SLOW_MS);
    } else if (saved.status === 'uploading') {
      setStep(2);
      startPolling(saved.id, POLL_FAST_MS);
    } else {
      setStep(2); // pending — faili pole veel saadetud
    }
  }

  // ---------------------------------------------------------------------------
  // Arvutused
  // ---------------------------------------------------------------------------
  const files = pollResult?.files ?? [];
  const filesWithLocalDeleted = files.map((f) => ({
    ...f,
    deleted: f.deleted || localDeleted.has(f.page),
  }));
  const readyCount = filesWithLocalDeleted.filter((f) => f.has_ocr && !f.deleted).length;
  const progress = pollResult?.progress;
  const progressPct =
    progress && progress.bytes_total > 0
      ? Math.round((progress.bytes_sent / progress.bytes_total) * 100)
      : 0;
  const status = pollResult?.status ?? '';
  const ocrTimedOut =
    ocrStartedAt !== null &&
    Date.now() - ocrStartedAt > OCR_TIMEOUT_MS &&
    status !== 'done';
  const canImport = readyCount > 0 && !importLoading;

  // Kollektsioonide loend (sortimine nime järgi)
  const collectionList = Object.entries(collections).sort(([, a], [, b]) => {
    const nameA = typeof a.name === 'object' ? (a.name[lang] ?? a.name['et'] ?? '') : String(a.name);
    const nameB = typeof b.name === 'object' ? (b.name[lang] ?? b.name['et'] ?? '') : String(b.name);
    return nameA.localeCompare(nameB, lang);
  });

  const stepLabels: [string, string, string] = [
    t('steps.metadata'),
    t('steps.upload'),
    t('steps.review'),
  ];

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------
  return (
    <div className="min-h-screen bg-gray-50">
      <Header pageTitle={t('title')} pageTitleIcon={<UploadIcon size={20} className="text-primary-600" />} />

      <div className="max-w-3xl mx-auto px-4 py-8">

        {/* Pooleliolevad üleslaadimised (ainult kui ühtegi aktiivset pole) */}
        {!uploadId && (
          <div className="mb-8">
            {loadingPending ? (
              <div className="flex items-center gap-2 text-gray-500 text-sm">
                <Loader2 size={16} className="animate-spin" />
                <span>Laen...</span>
              </div>
            ) : pendingUploads.length > 0 ? (
              <div className="bg-white rounded-xl border border-gray-200 p-4 shadow-sm">
                <h2 className="font-semibold text-gray-800 mb-3 text-sm">{t('pending.title')}</h2>
                <div className="space-y-2">
                  {pendingUploads.map((u) => (
                    <div
                      key={u.id}
                      className="flex items-center justify-between p-3 rounded-lg bg-gray-50 border border-gray-200"
                    >
                      <div>
                        <p className="font-medium text-gray-900 text-sm">{u.meta.title}</p>
                        <p className="text-xs text-gray-500">
                          {u.meta.year} · data/{u.meta.year}_{u.meta.slug}/ ·{' '}
                          <span
                            className={`font-medium ${
                              u.status === 'done'
                                ? 'text-green-600'
                                : u.status === 'error'
                                ? 'text-red-500'
                                : 'text-amber-600'
                            }`}
                          >
                            {t(`status.${u.status}`, u.status)}
                          </span>
                        </p>
                      </div>
                      <button
                        onClick={() => handleResume(u)}
                        className="text-sm font-medium text-primary-600 hover:text-primary-800 px-3 py-1.5 rounded-md hover:bg-primary-50 transition-colors"
                      >
                        {t('pending.resume')}
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        )}

        {/* Sammuindikaator */}
        <StepIndicator step={step} labels={stepLabels} />

        {/* ------------------------------------------------------------------ */}
        {/* SAMM 1: Metaandmed                                                  */}
        {/* ------------------------------------------------------------------ */}
        {step === 1 && (
          <div className="bg-white rounded-xl border border-gray-200 p-6 shadow-sm">
            <h2 className="text-lg font-semibold text-gray-900 mb-5">{t('step1.title')}</h2>

            {/* Pealkiri */}
            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-1">
                {t('step1.titleLabel')} <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder={t('step1.titlePlaceholder')}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
              />
            </div>

            {/* Aasta */}
            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-1">
                {t('step1.yearLabel')} <span className="text-red-500">*</span>
              </label>
              <input
                type="number"
                value={year}
                onChange={(e) => setYear(e.target.value)}
                placeholder={t('step1.yearPlaceholder')}
                min={1200}
                max={1800}
                className="w-48 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
              />
            </div>

            {/* Slug */}
            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-1">
                {t('step1.slugLabel')}
              </label>
              <input
                type="text"
                value={slug}
                onChange={(e) => {
                  setSlugManual(true);
                  setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-'));
                }}
                className={`w-full border rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent ${
                  slugConflict ? 'border-red-400 bg-red-50' : 'border-gray-300'
                }`}
              />
              <p
                className={`text-xs mt-1 ${slugConflict ? 'text-red-600 font-medium' : 'text-gray-400'}`}
              >
                {slugConflict
                  ? step1Error
                  : t('step1.slugHint').replace('{{slug}}', slug || '…')}
              </p>
            </div>

            {/* Kollektsioon */}
            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-1">
                {t('step1.collectionLabel')}
              </label>
              <select
                value={selectedCollection}
                onChange={(e) => setSelectedCollection(e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 bg-white"
              >
                <option value="">{t('step1.collectionNone')}</option>
                {collectionList.map(([id, col]) => (
                  <option key={id} value={id}>
                    {typeof col.name === 'object'
                      ? (col.name[lang] ?? col.name['et'] ?? id)
                      : String(col.name)}
                  </option>
                ))}
              </select>
            </div>

            {/* Vea teade (muu viga peale slug konflikti) */}
            {step1Error && !slugConflict && (
              <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
                {step1Error}
              </div>
            )}

            <button
              onClick={handleStep1Submit}
              disabled={!title.trim() || !year.trim() || step1Loading || slugConflict}
              className="w-full flex items-center justify-center gap-2 bg-primary-600 hover:bg-primary-700 disabled:bg-gray-300 text-white font-medium py-2.5 px-4 rounded-lg transition-colors text-sm"
            >
              {step1Loading ? (
                <Loader2 size={16} className="animate-spin" />
              ) : null}
              {t('step1.continue')}
            </button>
            <p className="text-xs text-gray-400 text-center mt-2">
              ⏱ {t('step1.timeEstimate')}
            </p>
          </div>
        )}

        {/* ------------------------------------------------------------------ */}
        {/* SAMM 2: Faili üleslaadimine                                         */}
        {/* ------------------------------------------------------------------ */}
        {step === 2 && (
          <div className="bg-white rounded-xl border border-gray-200 p-6 shadow-sm">
            <h2 className="text-lg font-semibold text-gray-900 mb-5">{t('step2.title')}</h2>

            {/* Teose info */}
            <div className="mb-5 p-3 bg-gray-50 rounded-lg text-sm text-gray-600 border border-gray-200">
              <span className="font-medium text-gray-800">{title}</span>
              {' · '}
              {year}
              {' · '}
              <span className="font-mono text-xs">data/{year}_{slug}/</span>
            </div>

            {/* Upload progress (kui SFTP käib) */}
            {(status === 'uploading' || status === 'processing') ? (
              <div className="space-y-3">
                <div className="flex items-center gap-3">
                  <Loader2 size={20} className="animate-spin text-primary-600 shrink-0" />
                  <div className="flex-1">
                    <p className="text-sm font-medium text-gray-800">
                      {status === 'uploading' ? t('step2.uploading') : t('step2.processing')}
                    </p>
                    <p className="text-xs text-gray-500">{t('step2.waitNote')}</p>
                  </div>
                </div>

                {/* Progress bar (ainult upload ajaks) */}
                {status === 'uploading' && progress && progress.bytes_total > 0 && (
                  <div>
                    <div className="flex justify-between text-xs text-gray-500 mb-1">
                      <span>{t('step2.progressLabel').replace('{{pct}}', String(progressPct))}</span>
                      <span>
                        {Math.round(progress.bytes_sent / 1024 / 1024)} /{' '}
                        {Math.round(progress.bytes_total / 1024 / 1024)} MB
                      </span>
                    </div>
                    <div className="w-full bg-gray-200 rounded-full h-2">
                      <div
                        className="bg-primary-600 h-2 rounded-full transition-all duration-300"
                        style={{ width: `${progressPct}%` }}
                      />
                    </div>
                  </div>
                )}

                {/* Veateade progressis */}
                {progress?.error && (
                  <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
                    <AlertTriangle size={14} className="inline mr-1" />
                    {progress.error}
                  </div>
                )}
              </div>
            ) : (
              /* Drag & drop tsoon */
              <>
                <div
                  onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
                  onDragLeave={() => setDragging(false)}
                  onDrop={handleDrop}
                  onClick={() => fileInputRef.current?.click()}
                  className={`border-2 border-dashed rounded-xl p-10 text-center cursor-pointer transition-colors ${
                    dragging
                      ? 'border-primary-400 bg-primary-50'
                      : 'border-gray-300 hover:border-primary-400 hover:bg-gray-50'
                  }`}
                >
                  <FileUp
                    size={36}
                    className={`mx-auto mb-3 ${dragging ? 'text-primary-500' : 'text-gray-400'}`}
                  />
                  <p className="text-sm font-medium text-gray-700">
                    {dragging ? t('step2.dropzoneActive') : t('step2.dropzone')}
                  </p>
                  <p className="text-xs text-gray-400 mt-1">PDF</p>
                </div>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".pdf,application/pdf"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) handleFileUpload(file);
                  }}
                />

                {uploadError && (
                  <div className="mt-3 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
                    <AlertTriangle size={14} className="inline mr-1" />
                    {uploadError}
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {/* ------------------------------------------------------------------ */}
        {/* SAMM 3: Ülevaatus                                                   */}
        {/* ------------------------------------------------------------------ */}
        {step === 3 && (
          <div className="bg-white rounded-xl border border-gray-200 p-6 shadow-sm">
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-lg font-semibold text-gray-900">{t('step3.title')}</h2>
              <div className="flex items-center gap-2 text-sm">
                {status === 'done' ? (
                  <span className="flex items-center gap-1 text-green-600 font-medium">
                    <CheckCircle size={16} />
                    {t('step3.done')}
                  </span>
                ) : (
                  <span className="flex items-center gap-1 text-amber-600 font-medium">
                    <Clock size={16} />
                    {t('step3.processing')}
                  </span>
                )}
              </div>
            </div>

            {/* OCR statistika */}
            <div className="flex gap-4 text-sm text-gray-600 mb-4">
              <span>
                {t('step3.readyCount')
                  .replace('{{ready}}', String(readyCount))
                  .replace('{{total}}', String(filesWithLocalDeleted.filter((f) => !f.deleted).length))}
              </span>
              {pollResult?.expected_pages && (
                <span className="text-gray-400">
                  {t('step3.expectedPages').replace('{{n}}', String(pollResult.expected_pages))}
                </span>
              )}
            </div>

            {/* OCR timeout hoiatus */}
            {ocrTimedOut && (
              <div className="mb-4 p-3 bg-amber-50 border border-amber-200 rounded-lg text-sm text-amber-800 flex items-start gap-2">
                <AlertTriangle size={16} className="shrink-0 mt-0.5" />
                <span>{t('step3.timeoutWarning')}</span>
              </div>
            )}

            {/* Pisipiltide ruudustik */}
            {filesWithLocalDeleted.length === 0 ? (
              <div className="flex items-center justify-center h-32 text-gray-400 text-sm">
                <Loader2 size={20} className="animate-spin mr-2" />
                <span>{t('step2.processing')}</span>
              </div>
            ) : (
              <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-2 mb-6">
                {filesWithLocalDeleted.map((entry) =>
                  uploadId && authToken ? (
                    <ThumbCard
                      key={entry.page}
                      entry={entry}
                      uploadId={uploadId}
                      authToken={authToken}
                      onDelete={handleDeletePage}
                      onRestore={handleRestorePage}
                      t={(key) => t(key)}
                    />
                  ) : null
                )}
              </div>
            )}

            {/* Impordi nupp */}
            {importError && (
              <div className="mb-3 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
                <AlertTriangle size={14} className="inline mr-1" />
                {importError}
              </div>
            )}
            <button
              onClick={handleImport}
              disabled={!canImport}
              title={canImport ? '' : t('step3.importDisabled')}
              className="w-full flex items-center justify-center gap-2 bg-green-600 hover:bg-green-700 disabled:bg-gray-300 text-white font-medium py-2.5 px-4 rounded-lg transition-colors text-sm"
            >
              {importLoading ? (
                <Loader2 size={16} className="animate-spin" />
              ) : (
                <CheckCircle size={16} />
              )}
              {t('step3.importBtn')}
            </button>
          </div>
        )}

        {/* Tühista nupp (samm 2 ja 3) */}
        {step > 1 && (
          <div className="mt-4 flex justify-center">
            <button
              onClick={handleCancel}
              className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-red-600 transition-colors"
            >
              <Trash2 size={14} />
              {t('cancel')}
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

export default Upload;
