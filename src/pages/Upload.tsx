/**
 * Upload leht — admin teose lisamine PDF-ist OCR kaudu.
 *
 * Etapp 3: samm-sammuline viisard (metaandmed → üleslaadimine → ülevaatus).
 * Etapp 4 lisab: "Impordi" nupuks backend logika.
 */
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import {
  Upload as UploadIcon,
  ChevronLeft,
  FileUp,
  CheckCircle,
  Clock,
  Loader2,
  Trash2,
  AlertTriangle,
  X,
  Info,
  ListTodo,
} from 'lucide-react';
import Header from '../components/Header';
import UploadMetaForm from '../components/UploadMetaForm';
import UploadStepMeta from './upload/components/UploadStepMeta';
import { buildReplaceUploadPayload } from '../utils/buildReplaceUploadPayload';
import { FILE_API_URL } from '../config';
import { useUser } from '../contexts/UserContext';
import { useCollection } from '../contexts/CollectionContext';
import { getLangCode } from '../utils/getLangCode';
import type { FileEntry, PollResult, SavedUpload, UploadType } from './upload/types';
import {
  ApiError,
  createUpload,
  deleteUpload,
  getReplaceWorkMetadata,
  getUploadStatus,
  importUpload,
  listUploads,
  replaceWorkUpload,
  uploadImagePage,
  uploadSingleFile,
} from './upload/uploadApi';

const POLL_SLOW_MS = 5000;
const POLL_FAST_MS = 2000;
const OCR_TIMEOUT_MS_FALLBACK = 2 * 60 * 60 * 1000; // 2 tundi (kui lehekülgede arv teadmata)
const OCR_MS_PER_PAGE = 60 * 1000; // ~60 sek/lk (konservatiivne, timeout'i jaoks)
const OCR_PAGES_PER_MIN = 2.5; // Reaalne OCR kiirus lehekülgi minutis (ajahinnangu kuvamiseks)

/** Arvutab OCR ajahinnangu lehekülgede arvu põhjal. */
function ocrEstimate(pages: number | null | undefined): string {
  if (!pages) return '~10 min';
  const mins = Math.ceil(pages / OCR_PAGES_PER_MIN);
  return `~${mins} min`;
}

const TYPE_PRINT: UploadType = { id: 'Q1261026', label: 'trükis',   source: 'wikidata', labels: { et: 'trükis',   en: 'printed matter' } };
const TYPE_HAND: UploadType  = { id: 'Q87167',  label: 'käsikiri', source: 'wikidata', labels: { et: 'käsikiri', en: 'manuscript' } };

// ---------------------------------------------------------------------------
// Slug utiliit (peegeldab serveri sanitize_slug)
// ---------------------------------------------------------------------------
const SLUG_MAX_LEN = 80;

function sanitizeSlug(text: string): string {
  return (
    text
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .slice(0, SLUG_MAX_LEN)
      .replace(/-+$/g, '') || 'teos'
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
  t: (key: string) => string;
}> = ({ entry, uploadId, authToken, t }) => {
  const thumbUrl = `${FILE_API_URL}/admin/upload/${uploadId}/thumb/${entry.page}?token=${authToken}`;

  return (
    <div
      className={`relative rounded-lg overflow-hidden border-2 transition-all ${
        entry.has_ocr
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
          entry.has_ocr
            ? 'bg-green-50 text-green-700'
            : 'bg-yellow-50 text-yellow-700'
        }`}
      >
        <span>Lk {entry.page}</span>
        <span>
          {entry.has_ocr
            ? t('step3.ocrReady')
            : t('step3.ocrProcessing')}
        </span>
      </div>
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
  const [searchParams] = useSearchParams();
  const lang = getLangCode(i18n.language);

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
  const [workType, setWorkType] = useState(TYPE_PRINT);
  const [slug, setSlug] = useState('');
  const [slugManual, setSlugManual] = useState(false);

  const [selectedCollection, setSelectedCollection] = useState('');
  const [step1Loading, setStep1Loading] = useState(false);
  const [step1Error, setStep1Error] = useState('');

  // --- Asenda olemasolevat teost ---
  const [replaceWorkId, setReplaceWorkId] = useState<string | null>(null);
  const [replaceWorkTitle, setReplaceWorkTitle] = useState<string | null>(null);
  const [autoCreateLoading, setAutoCreateLoading] = useState(false);
  const [autoCreateError, setAutoCreateError] = useState('');

  // --- Samm 2 ---
  const [dragging, setDragging] = useState(false);
  const [uploadError, setUploadError] = useState('');
  const [fileUploading, setFileUploading] = useState(false); // lipp: fail on valitud ja upload käib
  const fileInputRef = useRef<HTMLInputElement>(null);

  // --- Multi-image üleslaadimine ---
  const [pendingMultiFiles, setPendingMultiFiles] = useState<File[]>([]); // valitud, aga veel mitte üles laaditud
  const [multiCurrentNum, setMultiCurrentNum] = useState(0);
  const [multiTotalNum, setMultiTotalNum] = useState(0);

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
  // Loe replaceWorkId URL parameetritest ja loo upload automaatselt (samm 1 vahelejätmine)
  // ---------------------------------------------------------------------------
  useEffect(() => {
    const rid = searchParams.get('replaceWorkId');
    const rtitle = searchParams.get('replaceWorkTitle');
    if (!rid) return;

    setReplaceWorkId(rid);
    setReplaceWorkTitle(rtitle);

    // Oota kuni authToken on saadaval (auth võib olla laadimises)
    if (!authToken) return;

    setAutoCreateLoading(true);
    setAutoCreateError('');

    (async () => {
      try {
        // 1. Lae teose metaandmed
        const meta = await getReplaceWorkMetadata(rid, authToken);

        const fetchedTitle: string = meta.title || '';
        const fetchedYear: string = meta.year ? String(meta.year) : '';
        const fetchedSlug: string = meta.slug || sanitizeSlug((fetchedYear ? fetchedYear + '-' : '') + fetchedTitle);
        const fetchedCollection: string = Array.isArray(meta.collections) && meta.collections.length > 0
          ? meta.collections[0]
          : '';

        // Täida vormiväljad juhuks kui auto-loomine ebaõnnestub
        setTitle(fetchedTitle);
        setYear(fetchedYear);
        setSlug(fetchedSlug);
        setSlugManual(true);
        if (fetchedCollection) setSelectedCollection(fetchedCollection);

        // 2. Loo upload staging automaatselt
        // Asendamise voog jätab Step 1 vahele — type tuleb asendatava teose metaandmetest (backend loeb ise)
        const createData = await createUpload(buildReplaceUploadPayload(meta, rid), authToken);

        // 3. Eduka loomise korral hüppa samm 2-sse
        setUploadId(createData.upload.id);
        setStep(2);
      } catch (e: any) {
        setAutoCreateError(e.message || 'Viga uploadi automaatsel loomisel');
      } finally {
        setAutoCreateLoading(false);
      }
    })();
  }, [authToken]);

  // ---------------------------------------------------------------------------
  // Laadi pooleliolevad üleslaadimised
  // ---------------------------------------------------------------------------
  useEffect(() => {
    if (!authToken) return;
    listUploads(authToken)
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
    setStep1Error('');
  }, [slug, year]);

  function handleReplaceDismiss() {
    setReplaceWorkId(null);
    setReplaceWorkTitle(null);
  }

  // ---------------------------------------------------------------------------
  // Polling
  // ---------------------------------------------------------------------------
  const stopPolling = useCallback(() => {
    if (pollTimerRef.current) {
      clearInterval(pollTimerRef.current);
      pollTimerRef.current = null;
    }
  }, []);

  const fetchStatus = useCallback(
    async (id: string) => {
      if (!authToken) return;
      try {
        const d: PollResult = await getUploadStatus(id, authToken);
        setPollResult(d);
        if (['processing', 'reviewing', 'done'].includes(d.status)) {
          setStep(3);
          if (ocrStartedAt === null) setOcrStartedAt(Date.now());
        }
        if (['done', 'error', 'imported'].includes(d.status)) {
          stopPolling();
        }
      } catch {
        // Ignoreerime ajutisi võrgu vigu
      }
    },
    [authToken, stopPolling, ocrStartedAt]
  );

  const startPolling = useCallback(
    (id: string, intervalMs = POLL_SLOW_MS) => {
      stopPolling();
      pollTimerRef.current = setInterval(() => fetchStatus(id), intervalMs);
    },
    [stopPolling, fetchStatus]
  );

  useEffect(() => () => stopPolling(), [stopPolling]);

  // ---------------------------------------------------------------------------
  // Samm 1 — staging loomine
  // ---------------------------------------------------------------------------
  async function handleStep1Submit() {
    if (!title.trim() || !authToken) return;
    if (workType.id !== 'Q87167' && !year.trim()) return;
    setStep1Loading(true);
    setStep1Error('');

    // Proovi slug-iga, konflikt → lisa juhuslik 4-tähtne sufiks, korda max 3×
    const randSuffix = () => Math.random().toString(36).slice(2, 6);
    let candidateSlug = slug;
    let attempts = 0;

    try {
      while (attempts < 3) {
        try {
          const d = await createUpload({
            title: title.trim(),
            year: year.trim(),
            slug: candidateSlug,
            collections: selectedCollection ? [selectedCollection] : [],
            replace_work_id: replaceWorkId || null,
            type: workType,
          }, authToken);
          // Backend küpsetab work_id slug'i → kuva reaalne kaustanimi (data/{slug}-{work_id}/)
          if (d.upload?.meta?.slug) setSlug(d.upload.meta.slug);
          setUploadId(d.upload.id);
          setStep(2);
          return;
        } catch (e) {
          if (e instanceof ApiError && e.data && typeof e.data === 'object' && (e.data as { conflict?: boolean }).conflict) {
            candidateSlug = `${slug}-${randSuffix()}`;
            attempts++;
          } else {
            setStep1Error(e instanceof Error ? e.message : t('errors.createFailed'));
            return;
          }
        }
      }
      // 3 katset ebaõnnestus (väga ebatõenäoline)
      setStep1Error(t('errors.createFailed'));
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
    setFileUploading(true); // näita kohe spinner/bänner, sõltumata pollingust

    // Näita kohe laadimise indikaatorit (polling pole veel vastanud)
    setPollResult((prev) => ({
      ready: 0, total: 0, expected_pages: null, files: [],
      ...(prev ?? {}),
      status: 'uploading',
    }));

    // Alusta kiire pollinguga saatmise ajaks
    startPolling(uploadId, POLL_FAST_MS);

    try {
      await uploadSingleFile(uploadId, file, authToken);
      // 202 — SFTP transfer algas taustal, polling jätkab
    } catch (e) {
      setUploadError(e instanceof ApiError && e.status === 413 ? t('errors.fileTooLarge') : t('errors.uploadFailed'));
      setFileUploading(false);
      stopPolling();
    }
  }

  // Mitme JPG/PNG faili järjestikuline üleslaadimine
  async function handleMultipleImageUpload(files: File[]) {
    if (!uploadId || !authToken) return;
    setUploadError('');
    setFileUploading(true);
    setMultiTotalNum(files.length);
    setMultiCurrentNum(0);
    setPendingMultiFiles([]);

    for (let i = 0; i < files.length; i++) {
      setMultiCurrentNum(i + 1);
      try {
        await uploadImagePage(uploadId, files[i], i + 1, files.length, authToken);
      } catch (e) {
        setUploadError(e instanceof ApiError && e.status === 413 ? t('errors.fileTooLarge') : t('errors.uploadFailed'));
        setFileUploading(false);
        return;
      }
    }

    // Kõik failid üles laaditud → alusta pollingut
    startPolling(uploadId, POLL_FAST_MS);
  }

  // Faili(de) valik — eraldab PDF vs üks pilt vs mitu pilti
  function handleFilesSelected(files: File[]) {
    if (files.length === 0) return;
    setUploadError('');

    if (files.length === 1) {
      handleFileUpload(files[0]);
      return;
    }

    // Mitu faili — ainult pildid lubatud
    const images = files.filter((f) => {
      const n = f.name.toLowerCase();
      return n.endsWith('.jpg') || n.endsWith('.jpeg') || n.endsWith('.png') || n.endsWith('.tif') || n.endsWith('.tiff');
    });

    if (images.length !== files.length) {
      setUploadError('Mitme faili puhul on lubatud ainult JPG/PNG pildid (mitte PDF).');
      return;
    }

    // Sorteeri nime järgi ja näita eelvaate nimekirja
    const sorted = [...images].sort((a, b) => a.name.localeCompare(b.name));
    setPendingMultiFiles(sorted);
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragging(false);
    const files = Array.from(e.dataTransfer.files);
    if (files.length > 0) handleFilesSelected(files);
  }

  // ---------------------------------------------------------------------------
  // Import (etapp 4 implementeerib backend — praegu placeholder)
  // ---------------------------------------------------------------------------
  async function handleImport() {
    if (!uploadId || !authToken) return;
    setImportLoading(true);
    setImportError('');
    try {
      const d = await importUpload(uploadId, authToken);
      stopPolling();
      setFileUploading(false);
      // Suuna tööle
      navigate(`/work/${d.work_id}`);
    } catch (e) {
      setImportError(e instanceof Error ? e.message : t('step3.importError'));
    } finally {
      setImportLoading(false);
    }
  }

  // ---------------------------------------------------------------------------
  // Asenda olemasoleva teose sisu (replace-work endpoint)
  // ---------------------------------------------------------------------------
  async function handleReplaceImport() {
    if (!uploadId || !replaceWorkId || !authToken) return;
    setImportLoading(true);
    setImportError('');
    try {
      const d = await replaceWorkUpload(uploadId, replaceWorkId, authToken);
      stopPolling();
      setFileUploading(false);
      navigate(`/work/${d.work_id}/1`);
    } catch (e) {
      setImportError(e instanceof Error ? e.message : t('step3.importError'));
    } finally {
      setImportLoading(false);
    }
  }

  // ---------------------------------------------------------------------------
  // Sulge viisard (upload jääb taustal tööle)
  // ---------------------------------------------------------------------------
  function handleClose() {
    stopPolling();
    setUploadId(null);
    setStep(1);
    setPollResult(null);
    setFileUploading(false);
    setTitle('');
    setYear('');
    setWorkType(TYPE_PRINT);
    setSlug('');
    setSlugManual(false);
    setLocalDeleted(new Set());
    setOcrStartedAt(null);
    setPendingMultiFiles([]);
    setMultiCurrentNum(0);
    setMultiTotalNum(0);
    setReplaceWorkId(null);
    setReplaceWorkTitle(null);
    // Värskenda pooleliolevate nimekirja
    if (authToken) {
      listUploads(authToken)
        .then((d) => setPendingUploads(d.uploads || []))
        .catch(() => {});
    }
  }

  // ---------------------------------------------------------------------------
  // Tühistamine (DELETE — kustutab uploadi serverist)
  // ---------------------------------------------------------------------------
  async function handleCancel() {
    if (!window.confirm(t('cancelConfirm'))) return;
    stopPolling();
    if (uploadId && authToken) {
      await deleteUpload(uploadId, authToken).catch(() => {});
    }
    setUploadId(null);
    setStep(1);
    setPollResult(null);
    setFileUploading(false);
    setTitle('');
    setYear('');
    setWorkType(TYPE_PRINT);
    setSlug('');
    setSlugManual(false);
    setLocalDeleted(new Set());
    setOcrStartedAt(null);
    setPendingMultiFiles([]);
    setMultiCurrentNum(0);
    setMultiTotalNum(0);
    setReplaceWorkId(null);
    setReplaceWorkTitle(null);
  }

  // ---------------------------------------------------------------------------
  // Poolelioleva üleslaadimise jätkamine
  // ---------------------------------------------------------------------------
  function handleResume(saved: SavedUpload) {
    setUploadId(saved.id);
    setTitle(saved.meta.title);
    // saved.meta.year võib backendist tulla numbrina, kuigi tüüp ütleb string
    // — year-olek on alati string, muidu YearInputPreview .trim() crashib
    setYear(saved.meta.year != null ? String(saved.meta.year) : '');
    setSlug(saved.meta.slug);
    setWorkType(saved.meta.type?.id === 'Q87167' ? TYPE_HAND : TYPE_PRINT);
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
      setFileUploading(true);
      setOcrStartedAt(Date.now() - POLL_SLOW_MS); // Eeldame et on juba alustanud
      fetchStatus(saved.id); // Vahetu päring — ära kuva vananenud cached andmeid
      startPolling(saved.id, POLL_SLOW_MS);
    } else if (saved.status === 'uploading') {
      setStep(2);
      setFileUploading(true);
      fetchStatus(saved.id); // Vahetu päring
      startPolling(saved.id, POLL_FAST_MS);
    } else if (saved.status === 'collecting_images') {
      setStep(2); // Piltide üleslaadimine katkes — kasutaja peab failid uuesti valima
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
  const ocrTimeoutMs = pollResult?.expected_pages
    ? Math.max(5 * 60 * 1000, pollResult.expected_pages * OCR_MS_PER_PAGE)
    : OCR_TIMEOUT_MS_FALLBACK;
  const ocrTimedOut =
    ocrStartedAt !== null &&
    Date.now() - ocrStartedAt > ocrTimeoutMs &&
    status !== 'done';
  const canImport = (status === 'done' || ocrTimedOut) && readyCount > 0 && !importLoading;
  const estimatedTime = ocrEstimate(pollResult?.expected_pages);

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

      <div className="max-w-5xl mx-auto px-4 py-8">
        <Link to="/admin" className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700 mb-6">
          <ChevronLeft size={16} />
          Admin
        </Link>

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
                  {pendingUploads.map((u) => {
                    const canResume = ['pending', 'uploading', 'processing', 'reviewing', 'done'].includes(u.status);
                    const isError = u.status === 'error';
                    const isImported = u.status === 'imported';
                    return (
                    <div
                      key={u.id}
                      className="flex items-center justify-between p-3 rounded-lg bg-gray-50 border border-gray-200"
                    >
                      <div>
                        <p className="font-medium text-gray-900 text-sm">{u.meta.title}</p>
                        <p className="text-xs text-gray-500">
                          {u.meta.year} · data/{u.meta.slug}/ ·{' '}
                          <span
                            className={`font-medium ${
                              u.status === 'done' || u.status === 'imported'
                                ? 'text-green-600'
                                : u.status === 'error'
                                ? 'text-red-500'
                                : 'text-amber-600'
                            }`}
                          >
                            {t(`status.${u.status}`, u.status)}
                          </span>
                          {u.stalled && (
                            <span
                              className="ml-2 inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-800 align-middle"
                              title={t('pending.stalledHint')}
                            >
                              <AlertTriangle size={11} />
                              {t('pending.stalled')}
                            </span>
                          )}
                        </p>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        {canResume && (
                          <button
                            onClick={() => handleResume(u)}
                            className="text-sm font-medium text-primary-600 hover:text-primary-800 px-3 py-1.5 rounded-md hover:bg-primary-50 transition-colors"
                          >
                            {t('pending.resume')}
                          </button>
                        )}
                        <button
                          onClick={async () => {
                            if (!window.confirm(t('cancelConfirm'))) return;
                            await deleteUpload(u.id, authToken).catch(() => {});
                            setPendingUploads((prev) => prev.filter((p) => p.id !== u.id));
                          }}
                          className={`text-sm font-medium px-3 py-1.5 rounded-md transition-colors ${
                            isError || isImported
                              ? 'text-red-600 hover:text-red-800 hover:bg-red-50'
                              : 'text-gray-400 hover:text-red-600 hover:bg-red-50'
                          }`}
                          title={t('cancel')}
                        >
                          <X size={15} />
                        </button>
                      </div>
                    </div>
                    );
                  })}
                </div>
              </div>
            ) : null}
          </div>
        )}

        {/* Sammuindikaator */}
        <StepIndicator step={step} labels={stepLabels} />

        {/* Eelteade: ainult samm 2-s enne faili valimist (samm 3-s on oma inline teade) */}
        {step === 2 && !fileUploading && (
          <div className="mb-6 p-4 bg-blue-50 border border-blue-300 rounded-xl text-sm text-blue-900 flex items-start gap-3 shadow-sm">
            <Info size={18} className="shrink-0 mt-0.5 text-blue-600" />
            <div>
              <p className="font-semibold mb-0.5">{t('notice.title', { time: estimatedTime })}</p>
              <p className="text-blue-800">{t('notice.body')}</p>
            </div>
          </div>
        )}

        {/* ------------------------------------------------------------------ */}
        {/* SAMM 1: Metaandmed                                                  */}
        {/* ------------------------------------------------------------------ */}
        {step === 1 && (
          <UploadStepMeta
            title={title}
            setTitle={setTitle}
            year={year}
            setYear={setYear}
            workType={workType}
            setWorkType={setWorkType}
            typePrint={TYPE_PRINT}
            typeHand={TYPE_HAND}
            slug={slug}
            selectedCollection={selectedCollection}
            setSelectedCollection={setSelectedCollection}
            collectionList={collectionList}
            lang={lang}
            step1Loading={step1Loading}
            step1Error={step1Error}
            autoCreateLoading={autoCreateLoading}
            autoCreateError={autoCreateError}
            replaceWorkId={replaceWorkId}
            replaceWorkTitle={replaceWorkTitle}
            onReplaceDismiss={handleReplaceDismiss}
            onSubmit={handleStep1Submit}
            t={t}
          />
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
              <span className="font-mono text-xs">data/{slug}/</span>
            </div>

            {/* Upload progress (kui SFTP käib) */}
            {fileUploading ? (
              <div className="space-y-3">
                <div className="flex items-center gap-3">
                  <Loader2 size={20} className="animate-spin text-primary-600 shrink-0" />
                  <p className="text-sm font-medium text-gray-800">
                    {multiTotalNum > 1
                      ? t('step2.uploadingMulti')
                          .replace('{{current}}', String(multiCurrentNum))
                          .replace('{{total}}', String(multiTotalNum))
                      : status === 'uploading'
                      ? t('step2.uploading')
                      : t('step2.processing')}
                  </p>
                </div>

                {/* Multi-image: ära lahku hoiatus */}
                {multiTotalNum > 1 ? (
                  <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg text-sm text-amber-800 flex items-start gap-2">
                    <AlertTriangle size={16} className="shrink-0 mt-0.5" />
                    <span>{t('step2.multipleImagesNote')}</span>
                  </div>
                ) : (
                  <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg text-sm text-blue-800 flex items-start gap-2">
                    <Info size={16} className="shrink-0 mt-0.5" />
                    <span>{t('step2.canLeaveNote', { time: estimatedTime })}</span>
                  </div>
                )}

                {/* Progress bar (ainult üksiku faili upload ajaks) */}
                {multiTotalNum <= 1 && status === 'uploading' && progress && progress.bytes_total > 0 && (
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

                {/* Multi-image progress bar */}
                {multiTotalNum > 1 && (
                  <div>
                    <div className="w-full bg-gray-200 rounded-full h-2">
                      <div
                        className="bg-primary-600 h-2 rounded-full transition-all duration-300"
                        style={{ width: `${Math.round(((multiCurrentNum - 1) / multiTotalNum) * 100)}%` }}
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
            ) : pendingMultiFiles.length > 0 ? (
              /* Mitu pilti valitud — näita nimekirja ja "Laadi üles" nuppu */
              <>
                <p className="text-sm text-gray-700 mb-2">
                  {t('step2.multiFilesSelected').replace('{{n}}', String(pendingMultiFiles.length))}
                </p>
                <ul className="mb-4 max-h-48 overflow-y-auto border border-gray-200 rounded-lg divide-y divide-gray-100 text-sm">
                  {pendingMultiFiles.map((f, i) => (
                    <li key={i} className="px-3 py-1.5 flex items-center gap-2 text-gray-700">
                      <span className="text-xs text-gray-400 w-5 text-right shrink-0">{i + 1}.</span>
                      <span className="font-mono truncate">{f.name}</span>
                    </li>
                  ))}
                </ul>
                <button
                  onClick={() => handleMultipleImageUpload(pendingMultiFiles)}
                  className="w-full flex items-center justify-center gap-2 bg-primary-600 hover:bg-primary-700 text-white font-medium py-2.5 px-4 rounded-lg transition-colors text-sm mb-2"
                >
                  <FileUp size={16} />
                  {t('step2.uploadAllBtn')}
                </button>
                <button
                  onClick={() => setPendingMultiFiles([])}
                  className="w-full text-sm text-gray-400 hover:text-gray-700 py-1 transition-colors"
                >
                  {t('cancelWizard')} (vali uuesti)
                </button>
                {uploadError && (
                  <div className="mt-3 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
                    <AlertTriangle size={14} className="inline mr-1" />
                    {uploadError}
                  </div>
                )}
              </>
            ) : (
              /* Drag & drop tsoon */
              <>
                {/* collecting_images resume teade */}
                {status === 'collecting_images' && (
                  <div className="mb-3 p-3 bg-amber-50 border border-amber-200 rounded-lg text-sm text-amber-800 flex items-start gap-2">
                    <AlertTriangle size={16} className="shrink-0 mt-0.5" />
                    <span>{t('step2.collectingImages')}</span>
                  </div>
                )}
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
                  <p className="text-xs text-gray-400 mt-1">PDF · JPG · PNG · mitu JPG/PNG korraga</p>
                </div>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".pdf,.jpg,.jpeg,.png,.tif,.tiff,application/pdf,image/jpeg,image/png,image/tiff"
                  multiple
                  className="hidden"
                  onChange={(e) => {
                    const files = Array.from(e.target.files ?? []);
                    if (files.length > 0) handleFilesSelected(files);
                    // Lähtesta input et sama failivalik toimiks uuesti
                    e.target.value = '';
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
                ) : pollResult?.stalled ? (
                  <span
                    className="flex items-center gap-1 text-amber-700 font-medium"
                    title={t('pending.stalledHint')}
                  >
                    <AlertTriangle size={16} />
                    {t('pending.stalled')}
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

            {/* Metaandmete muutmine OCR ootamise ajal ja pärast */}
            {uploadId && authToken && (
              <UploadMetaForm
                uploadId={uploadId}
                authToken={authToken}
                userRole={user?.role || 'contributor'}
                collections={collections}
                initialTitle={title}
                initialYear={year}
                initialCollections={selectedCollection ? [selectedCollection] : []}
                replaceWorkId={replaceWorkId}
                replaceWorkTitle={replaceWorkTitle}
              />
            )}

            {/* Info: OCR käib taustal, saab lahkuda */}
            {fileUploading && !ocrTimedOut && (
              <div className="mb-4 p-3 bg-blue-50 border border-blue-200 rounded-lg text-sm text-blue-800 flex items-start gap-2">
                <Info size={16} className="shrink-0 mt-0.5" />
                <span>{t('step3.canLeaveNote', { time: estimatedTime })}</span>
              </div>
            )}

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
            {replaceWorkId && replaceWorkTitle ? (
              <button
                onClick={handleReplaceImport}
                disabled={!canImport}
                title={canImport ? '' : status !== 'done' ? t('step3.importDisabledOcr') : t('step3.importDisabled')}
                className="w-full flex items-center justify-center gap-2 bg-red-600 hover:bg-red-700 disabled:bg-gray-300 text-white font-medium py-2.5 px-4 rounded-lg transition-colors text-sm"
              >
                {importLoading ? (
                  <Loader2 size={16} className="animate-spin" />
                ) : (
                  <AlertTriangle size={16} />
                )}
                {t('replaceWork.replaceBtn', { title: replaceWorkTitle ?? '' })}
              </button>
            ) : (
              <button
                onClick={handleImport}
                disabled={!canImport}
                title={canImport ? '' : status !== 'done' ? t('step3.importDisabledOcr') : t('step3.importDisabled')}
                className="w-full flex items-center justify-center gap-2 bg-green-600 hover:bg-green-700 disabled:bg-gray-300 text-white font-medium py-2.5 px-4 rounded-lg transition-colors text-sm"
              >
                {importLoading ? (
                  <Loader2 size={16} className="animate-spin" />
                ) : (
                  <CheckCircle size={16} />
                )}
                {t('step3.importBtn')}
              </button>
            )}
          </div>
        )}

        {/* Alumised nupud (samm 2 ja 3) */}
        {step > 1 && (
          <div className="mt-4 space-y-2">
            {fileUploading ? (
              /* Upload käib taustal — näita "Sulge" ja "Katkesta" eraldi */
              <>
                <button
                  onClick={handleClose}
                  className="w-full flex items-center justify-center gap-2 border border-primary-300 text-primary-700 hover:bg-primary-50 font-medium py-2.5 px-4 rounded-lg transition-colors text-sm"
                >
                  <ListTodo size={15} />
                  {t('closeAndMonitor')}
                </button>
                <div className="flex justify-center">
                  <button
                    onClick={handleCancel}
                    className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-red-600 transition-colors"
                  >
                    <Trash2 size={12} />
                    {t('cancelUpload')}
                  </button>
                </div>
              </>
            ) : (
              /* Faili pole veel valitud — lihtsalt katkesta viisard */
              <div className="flex justify-center">
                <button
                  onClick={handleCancel}
                  className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-red-600 transition-colors"
                >
                  <X size={14} />
                  {t('cancelWizard')}
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default Upload;
