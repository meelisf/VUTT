/**
 * useUploadWizard — upload-viisardi olekumasin (state machine).
 *
 * Koondab kogu sammude oleku, pollingu, üleminekud ja API-kutsete orkestreerimise
 * ühte hooki. `Upload.tsx` jääb õhukeseks orkestreerijaks, mis ainult renderdab.
 */
import { useState, useEffect, useRef, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useUser } from '../../contexts/UserContext';
import { buildReplaceUploadPayload } from '../../utils/buildReplaceUploadPayload';
import {
  TYPE_HAND,
  TYPE_PRINT,
  POLL_FAST_MS,
  POLL_SLOW_MS,
  adaSammuOlek,
} from './constants';
import { adaFetch, buildAdaCreateExtras } from './adaApi';
import {
  ocrEstimate,
  sanitizeSlug,
  prepareMultiImages,
  computeReviewDerived,
  estimateRemainingSeconds,
  formatEta,
} from './utils';
import {
  ApiError,
  UploadStalledError,
  createUpload,
  deleteUpload,
  getReplaceWorkMetadata,
  getUploadStatus,
  importUpload,
  listUploads,
  replaceWorkUpload,
  uploadImagePage,
  uploadSingleFile,
} from './uploadApi';
import type { AdaLookupResult, PollResult, SavedUpload } from './types';

/** Staatused, mille korral OCR-i pool on käigus → viisardi 4. samm. */
const REVIEW_STATUSES = ['applying', 'processing', 'reviewing', 'done'];

export function useUploadWizard() {
  const { t } = useTranslation(['upload', 'common']);
  const { authToken } = useUser();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  // --- Samm ja upload olek ---
  const [step, setStep] = useState<1 | 2 | 3 | 4>(1);
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
  // Brauser → VUTT saatmise edenemine; null = seda faasi ei käi (edasi räägib polling)
  const [sendProgress, setSendProgress] = useState<{ bytes_sent: number; bytes_total: number } | null>(null);
  const sendStartedAtRef = useRef<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // --- Multi-image üleslaadimine ---
  const [pendingMultiFiles, setPendingMultiFiles] = useState<File[]>([]); // valitud, aga veel mitte üles laaditud
  const [multiCurrentNum, setMultiCurrentNum] = useState(0);
  const [multiTotalNum, setMultiTotalNum] = useState(0);

  // --- Samm 3 ---
  const [localDeleted, setLocalDeleted] = useState<Set<number>>(new Set());
  const [importLoading, setImportLoading] = useState(false);
  const [importError, setImportError] = useState('');
  const [processingStartedAt, setProcessingStartedAt] = useState<number | null>(null);

  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

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

  // Laadi pooleliolevad üleslaadimised
  useEffect(() => {
    loadPendingUploads();
  }, [loadPendingUploads]);

  // Slug auto-genereerimine pealkirjast
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
    setProcessingStartedAt(null);
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
        // `adaSammuOlek` on ÜKS tõde selle kohta, kas staatus kuulub ADA
        // allalaadimise (2) või poolitamise (3) sammu — vt constants.ts.
        // `ada_fetching` EI TOHI kuuluda PREPRESS_STATUSES-esse — muidu
        // viskaks polling admini poolitamise vaatesse keset ~320 MB
        // allalaadimist (sama viga nagu `applying`, ADR 0028).
        const sammuOlek = adaSammuOlek(d.status);
        if (sammuOlek === 2) {
          // ADA allalaadimine käib VUTT-i poolel → progressiriba failivalija asemel.
          setStep(2);
          setFileUploading(true);
          if (d.status === 'ada_error') stopPolling();
          return;
        }
        if (sammuOlek === 3) {
          // Poolitamise samm — fail on VUTT-i poolel, OCR pole veel alanud.
          setStep(3);
          setFileUploading(false);
        }
        if (REVIEW_STATUSES.includes(d.status)) {
          setStep(4);
          // Ajatempel EI alga `applying` ajal: siis alles avaldatakse lehti ja
          // OCR jookseb nendega paralleelselt (ADR 0028). Timeout mõõdab
          // hetkest, mil sisendvoog on suletud ehk `processing`-ust.
          if (d.status !== 'applying' && processingStartedAt === null) {
            setProcessingStartedAt(Date.now());
          }
        }
        if (['done', 'error', 'imported'].includes(d.status)) {
          stopPolling();
        }
      } catch {
        // Ignoreerime ajutisi võrgu vigu
      }
    },
    [authToken, stopPolling, processingStartedAt]
  );

  const startPolling = useCallback(
    (id: string, intervalMs = POLL_SLOW_MS) => {
      stopPolling();
      pollTimerRef.current = setInterval(() => fetchStatus(id), intervalMs);
    },
    [stopPolling, fetchStatus]
  );

  useEffect(() => () => stopPolling(), [stopPolling]);

  /**
   * Samm 3 → 4: apply on käivitatud, lehed lähevad OCR-serverisse.
   *
   * Polling tuleb siin KÄIVITADA. Sammu 3 ajal ei polli `/status`-t keegi
   * (`awaiting_split` on prepress-idle ja UploadStepSplit küsib ainult
   * `/prepress`-i), nii et ilma selleta jääks samm 4 igavesti spinnerisse:
   * pisipildid, `ready/total` ja lõpetamise tuvastus tulevad AINULT
   * `/status` vastusest. Lehe värskendamine „parandas" vea ära, sest
   * handleResume käivitab pollingu — see peitis vea ära.
   */
  const handlePrepressApplied = useCallback(() => {
    if (!uploadId) return;
    setStep(4);
    setFileUploading(true);   // näita „Sulge ja jälgi" — OCR käib taustal
    // Ajatemplit siin EI seata: apply alles ALGAB. `fetchStatus` seab selle,
    // kui staatus jõuab `processing`-usse (ADR 0028).
    fetchStatus(uploadId);    // vahetu päring, et samm 4 ei ava tühjana
    startPolling(uploadId, POLL_SLOW_MS);
  }, [uploadId, fetchStatus, startPolling]);

  // ---------------------------------------------------------------------------
  // Samm 1 — staging loomine
  // ---------------------------------------------------------------------------
  /**
   * `adaResult` on Task 10 ADA-lookup'i tulemus (UploadStepMeta hoiab seda
   * lokaalse olekuna) — kui olemas, kannab create-payload ADA-ploki kaasa ja
   * käivitab kohe failide allalaadimise (`ada-fetch`), et samm 2 avaneks
   * juba progressiribaga, mitte failivalijaga.
   */
  async function handleStep1Submit(adaResult?: AdaLookupResult | null) {
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
            ...buildAdaCreateExtras(adaResult ?? null),
          }, authToken);
          // Backend küpsetab work_id slug'i → kuva reaalne kaustanimi (data/{slug}-{work_id}/)
          if (d.upload?.meta?.slug) setSlug(d.upload.meta.slug);
          setUploadId(d.upload.id);
          if (adaResult) {
            // Käivita kohe — ebaõnnestumise korral kukub see sama catch-i, mis
            // allpool (jääb sammu 1 peale nähtava veaga, staging jääb 'pending'-usse
            // ja järgmine „Laen uuesti" samm 2-s saab sellest CAS-iga jätkata).
            await adaFetch(d.upload.id, authToken);
            setFileUploading(true);
            setPollResult((prev) => ({
              ready: 0, total: 0, expected_pages: null, files: [],
              ...(prev ?? {}),
              status: 'ada_fetching',
            }));
            startPolling(d.upload.id, POLL_FAST_MS);
          }
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
    if (e instanceof UploadStalledError) return t('errors.uploadStalled');
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

    sendStartedAtRef.current = Date.now();
    try {
      await uploadSingleFile(uploadId, file, authToken, {
        onProgress: ({ loaded, total }) =>
          setSendProgress({ bytes_sent: loaded, bytes_total: total }),
      });
      // 202 — SFTP transfer algas taustal, polling jätkab
    } catch (e) {
      setUploadError(uploadErrorMessage(e));
      setFileUploading(false);
      stopPolling();
    } finally {
      // Edasi raporteerib edenemist polling (VUTT → OCR-server)
      setSendProgress(null);
      sendStartedAtRef.current = null;
    }
  }

  /**
   * „Laen uuesti" nupp `ada_error` olekus. Backendi CAS lubab
   * `ada_error → ada_fetching` ja juba kettal olevad tükid (`NNN.pdf`) ei lähe
   * uuesti alla — `alusta_fetchi` jätkab sealt, kus pooleli jäi.
   */
  const handleAdaRetry = useCallback(async () => {
    if (!uploadId || !authToken) return;
    setFileUploading(true);
    setPollResult((prev) => ({
      ready: 0, total: 0, expected_pages: null, files: [],
      ...(prev ?? {}),
      status: 'ada_fetching',
      error: undefined,
    }));
    try {
      await adaFetch(uploadId, authToken);
    } catch {
      // Serveri tõde loeb kohe järgmine poll — kui käivitus tegelikult ei
      // õnnestunud (nt CAS 409), näitab see uuesti `ada_error`-it.
    }
    startPolling(uploadId, POLL_FAST_MS);
  }, [uploadId, authToken, startPolling]);

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
    const sorted = prepareMultiImages(files);
    if (!sorted) {
      setUploadError('Mitme faili puhul on lubatud ainult JPG/PNG pildid (mitte PDF).');
      return;
    }

    // Näita eelvaate nimekirja
    setPendingMultiFiles(sorted);
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragging(false);
    const files = Array.from(e.dataTransfer.files);
    if (files.length > 0) handleFilesSelected(files);
  }

  // ---------------------------------------------------------------------------
  // Import
  // ---------------------------------------------------------------------------
  async function handleImport() {
    if (!uploadId || !authToken) return;
    setImportLoading(true);
    setImportError('');
    try {
      const d = await importUpload(uploadId, authToken);
      stopPolling();
      setFileUploading(false);
      const uploadWarning = d.warning || (d.git_committed === false ? t('step3.gitCommitWarning') : undefined);
      // Suuna tööle; Git-hoiatus kantakse kaasa, et admin seda sihtlehel näeks.
      navigate(`/work/${d.work_id}`, uploadWarning ? { state: { uploadWarning } } : undefined);
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

  // Poolelioleva üleslaadimise kustutamine nimekirjast (ei pruugi olla aktiivne)
  async function handleDeletePending(id: string) {
    if (!window.confirm(t('cancelConfirm'))) return;
    await deleteUpload(id, authToken).catch(() => {});
    setPendingUploads((prev) => prev.filter((p) => p.id !== id));
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

    // `adaSammuOlek` on ÜKS tõde ADA (2) vs poolitamise (3) sammu kohta —
    // sama helper mis `fetchStatus`-is, vt constants.ts.
    const resumeSammuOlek = adaSammuOlek(saved.status);
    if (resumeSammuOlek === 2) {
      // ADA allalaadimine käib (või seisab veaga) — samm 2, progressiriba.
      setStep(2);
      setFileUploading(true);
      fetchStatus(saved.id); // Vahetu päring — ära kuva vananenud cached andmeid
      startPolling(saved.id, POLL_FAST_MS);
    } else if (resumeSammuOlek === 3) {
      setStep(3); // poolitamise ootel — eelvaate olek loetakse UploadStepSplit'is
    } else if (REVIEW_STATUSES.includes(saved.status)) {
      setStep(4);
      setFileUploading(true);
      // `applying` ajal jääb null — sisendvoog on veel lahti (ADR 0028).
      if (saved.status !== 'applying') {
        setProcessingStartedAt(Date.now() - POLL_SLOW_MS); // Eeldame et on juba alustanud
      }
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

  // Deep-link: /upload?resumeUpload={id} avab otse selle uploadi ülevaatusele,
  // kui pendingUploads on laaditud. Param eemaldatakse pärast, et back/forward
  // remount ei käivitaks resume't uuesti.
  const resumeHandledRef = useRef(false);
  useEffect(() => {
    if (resumeHandledRef.current) return;
    const targetId = searchParams.get('resumeUpload');
    if (!targetId || pendingUploads.length === 0) return;
    const match = pendingUploads.find((u) => u.id === targetId);
    if (!match) return;
    resumeHandledRef.current = true;
    handleResume(match);
    navigate(window.location.pathname, { replace: true });
  }, [pendingUploads, searchParams, navigate]);

  // ---------------------------------------------------------------------------
  // Arvutused (puhas tuletus utils-ist)
  // ---------------------------------------------------------------------------
  const review = computeReviewDerived(
    pollResult, localDeleted, processingStartedAt, importLoading, Date.now(), sendProgress,
  );
  const estimatedTime = ocrEstimate(pollResult?.expected_pages);

  // Saatmise faas (brauser → VUTT): kestus tuleb kasutaja ühendusest, mitte
  // lehekülgede arvust, seega mõõdame selle ise. `sending` juhib ka seda, et
  // "võid lahkuda" / "Sulge" ei tohi selles faasis paista — lahkumine tapaks
  // XHR-i ja juba saadetud baidid läheksid kaotsi.
  const sending = sendProgress !== null;
  const sendEtaSeconds =
    sendProgress && sendStartedAtRef.current
      ? estimateRemainingSeconds(
          sendProgress.bytes_sent,
          sendProgress.bytes_total,
          Date.now() - sendStartedAtRef.current,
        )
      : null;
  const sendEta = sendEtaSeconds === null ? null : formatEta(sendEtaSeconds);

  return {
    // Olek
    step, setStep,
    uploadId,
    pollResult,
    pendingUploads,
    loadingPending,
    title, setTitle,
    year, setYear,
    workType, setWorkType,
    slug,
    selectedCollection, setSelectedCollection,
    step1Loading, step1Error,
    replaceWorkId, replaceWorkTitle,
    autoCreateLoading, autoCreateError,
    dragging, setDragging,
    uploadError,
    fileUploading,
    pendingMultiFiles, setPendingMultiFiles,
    multiCurrentNum, multiTotalNum,
    importLoading, importError,
    fileInputRef,

    // Tuletatud (samm 3)
    filesWithLocalDeleted: review.filesWithLocalDeleted,
    readyCount: review.readyCount,
    placeholderPages: review.placeholderPages,
    progress: review.progress,
    progressPct: review.progressPct,
    status: review.status,
    ocrTimedOut: review.ocrTimedOut,
    canImport: review.canImport,
    estimatedTime,
    sending,
    sendEta,

    // Tegevused
    handleReplaceDismiss,
    handleStep1Submit,
    handleMultipleImageUpload,
    handleFilesSelected,
    handleDrop,
    handleImport,
    handleReplaceImport,
    handleClose,
    handleCancel,
    handleDeletePending,
    handleResume,
    handlePrepressApplied,
    handleAdaRetry,
  };
}
