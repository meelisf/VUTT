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
  Loader2,
  Trash2,
  AlertTriangle,
  X,
  Info,
  ListTodo,
} from 'lucide-react';
import Header from '../components/Header';
import StepIndicator from './upload/components/StepIndicator';
import UploadStepMeta from './upload/components/UploadStepMeta';
import UploadStepTransfer from './upload/components/UploadStepTransfer';
import UploadStepReview from './upload/components/UploadStepReview';
import { TYPE_HAND, TYPE_PRINT, POLL_FAST_MS, POLL_SLOW_MS, OCR_MS_PER_PAGE, OCR_TIMEOUT_MS_FALLBACK } from './upload/constants';
import { ocrEstimate, sanitizeSlug } from './upload/utils';
import { buildReplaceUploadPayload } from '../utils/buildReplaceUploadPayload';
import { useUser } from '../contexts/UserContext';
import { useCollection } from '../contexts/CollectionContext';
import { getLangCode } from '../utils/getLangCode';
import type { PollResult, SavedUpload } from './upload/types';
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

  const loadPendingUploads = useCallback(async () => {
    if (!authToken) return;
    try {
      const data = await listUploads(authToken);
      setPendingUploads(data.uploads || []);
    } catch {
      // Pooleliolevate nimekiri pole kriitiline — vaikime ajutised vead maha.
    } finally {
      setLoadingPending(false);
    }
  }, [authToken]);

  // ---------------------------------------------------------------------------
  // Laadi pooleliolevad üleslaadimised
  // ---------------------------------------------------------------------------
  useEffect(() => {
    loadPendingUploads();
  }, [loadPendingUploads]);

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

  function resetWizardState() {
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
  /** Tõlgib faili üleslaadimise API vea kasutajale näidatavaks teateks.
   *  413 → fail liiga suur; muu ApiError → serveri detailne teade (nt SFTP
   *  timeout); võrguviga → üldine teade. */
  function uploadErrorMessage(e: unknown): string {
    if (e instanceof ApiError) {
      return e.status === 413 ? t('errors.fileTooLarge') : e.message;
    }
    return t('errors.uploadFailed');
  }

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
      setUploadError(uploadErrorMessage(e));
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
        setUploadError(uploadErrorMessage(e));
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
    resetWizardState();
    // Värskenda pooleliolevate nimekirja
    loadPendingUploads();
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
    resetWizardState();
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
          <UploadStepTransfer
            title={title}
            year={year}
            slug={slug}
            fileUploading={fileUploading}
            pendingMultiFiles={pendingMultiFiles}
            multiCurrentNum={multiCurrentNum}
            multiTotalNum={multiTotalNum}
            status={status}
            progress={progress}
            progressPct={progressPct}
            estimatedTime={estimatedTime}
            uploadError={uploadError}
            dragging={dragging}
            setDragging={setDragging}
            fileInputRef={fileInputRef}
            onDrop={handleDrop}
            onFilesSelected={handleFilesSelected}
            onMultipleImageUpload={handleMultipleImageUpload}
            onClearPendingMultiFiles={() => setPendingMultiFiles([])}
            t={t}
          />
        )}

        {/* ------------------------------------------------------------------ */}
        {/* SAMM 3: Ülevaatus                                                   */}
        {/* ------------------------------------------------------------------ */}
        {step === 3 && (
          <UploadStepReview
            status={status}
            pollResult={pollResult}
            readyCount={readyCount}
            filesWithLocalDeleted={filesWithLocalDeleted}
            uploadId={uploadId}
            authToken={authToken}
            userRole={user?.role || 'contributor'}
            collections={collections}
            title={title}
            year={year}
            selectedCollection={selectedCollection}
            replaceWorkId={replaceWorkId}
            replaceWorkTitle={replaceWorkTitle}
            fileUploading={fileUploading}
            ocrTimedOut={ocrTimedOut}
            estimatedTime={estimatedTime}
            importError={importError}
            canImport={canImport}
            importLoading={importLoading}
            onImport={handleImport}
            onReplaceImport={handleReplaceImport}
            t={t}
          />
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
