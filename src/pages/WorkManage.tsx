import React, { useState, useEffect, useRef, useMemo } from 'react';
import { isAtLeast } from '../utils/roleUtils';
import { useTranslation } from 'react-i18next';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { parseFocusParam, buildBackToEditorPath } from '../utils/manageDeeplink';
import {
  ArrowLeft,
  Plus,
  Loader2,
  Wrench,
  AlertTriangle,
  RotateCcw,
  FileImage,
  Upload,
  RefreshCw,
} from 'lucide-react';
import Header from '../components/Header';
import ConfirmModal from '../components/ConfirmModal';
import UnsavedChangesDialog from '../components/UnsavedChangesDialog';
import { useUnsavedChangesGuard } from '../hooks/useUnsavedChangesGuard';
import PageImageEditorModal from '../components/PageImageEditorModal';
import { useUser } from '../contexts/UserContext';
import { ApiError } from '../services/apiClient';
import {
  addWorkPages,
  deleteWork,
  deleteWorkPages,
  DeletedWorkPage,
  getDeletedWorkPages,
  getReocrStatus,
  getViewerToken,
  getWorkMetadata,
  getWorkPages,
  reorderWorkPages,
  replaceWorkPageImage,
  restoreDeletedWorkPage,
  startReocrBatch,
  WorkPageInfo,
} from '../services/workApi';
import { naturalCompare } from '../utils/naturalSort';
import { planChunks } from '../utils/bulkAddChunks';
import { computeBlockMoveOrder, VisiblePage } from '../utils/blockReorder';
import PageCard from './manage/PageCard';
import PageActionBar from './manage/PageActionBar';
import { mapReocrState, selectableNoTextFiles, ReocrStatusResponse } from '../utils/reocrStatus';

const CHUNK_MAX_FILES = 20;
const CHUNK_MAX_BYTES = 200 * 1024 * 1024;

type PageInfo = WorkPageInfo;
type DeletedPage = DeletedWorkPage;

type ActiveTab = 'pages' | 'trash' | 'replace';

const WorkManage: React.FC = () => {
  const { t } = useTranslation(['workspace', 'common']);
  const { workId } = useParams<{ workId: string }>();
  const navigate = useNavigate();
  const { user, authToken } = useUser();
  const [searchParams] = useSearchParams();
  const focus = parseFocusParam(searchParams.get('focus'));
  const focusedCardRef = useRef<HTMLDivElement | null>(null);
  const [highlightedNum, setHighlightedNum] = useState<number | null>(null);
  const handledFocusRef = useRef<number | null>(null);

  const [activeTab, setActiveTab] = useState<ActiveTab>('pages');
  const [pages, setPages] = useState<PageInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [workTitle, setWorkTitle] = useState('');

  // Pildi asendamine
  const [replaceError, setReplaceError] = useState<string | null>(null);
  const [replaceSuccess, setReplaceSuccess] = useState<string | null>(null);
  const [thumbCacheBust, setThumbCacheBust] = useState<number>(Date.now());

  // Lehekülje lisamine
  const [showAddForm, setShowAddForm] = useState(false);
  const [addAfterPage, setAddAfterPage] = useState<number>(-1);
  const [addFiles, setAddFiles] = useState<File[]>([]);
  const [showAllNames, setShowAllNames] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<{ done: number; total: number } | null>(null);
  const cancelRef = useRef(false);
  const [addingPage, setAddingPage] = useState(false);
  const [addPageError, setAddPageError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Prügikast (kustutatud leheküljed)
  const [trashPages, setTrashPages] = useState<DeletedPage[]>([]);
  const [trashLoading, setTrashLoading] = useState(false);
  const [trashLoaded, setTrashLoaded] = useState(false);
  const [trashError, setTrashError] = useState<string | null>(null);
  const [restoringPage, setRestoringPage] = useState<string | null>(null);
  const [restoreMessage, setRestoreMessage] = useState<{ text: string; ok: boolean } | null>(null);

  // Lehekülgede järjekorra muutmine
  const [draftPositions, setDraftPositions] = useState<Record<string, number>>({});
  const [reorderSaving, setReorderSaving] = useState(false);
  const [reorderError, setReorderError] = useState<string | null>(null);
  const [discardConfirmOpen, setDiscardConfirmOpen] = useState(false);
  const [reorderConfirmOpen, setReorderConfirmOpen] = useState(false);

  // Hulgivalik + liigutamine
  const [selectedFiles, setSelectedFiles] = useState<Set<string>>(new Set());
  const [moveTarget, setMoveTarget] = useState('');
  const lastSelectedIndexRef = useRef<number | null>(null);
  // Bulk-kustutus
  const [bulkDeleteConfirm, setBulkDeleteConfirm] = useState(false);
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const [bulkDeleteError, setBulkDeleteError] = useState<string | null>(null);

  // Re-OCR batch staatus + käivitus
  const [reocrStatus, setReocrStatus] = useState<ReocrStatusResponse | null>(null);
  const [ocrModel, setOcrModel] = useState<'print' | 'hand'>('print');
  const [batchConfirm, setBatchConfirm] = useState(false);
  const [batchError, setBatchError] = useState<string | null>(null);
  const [reocrPollNonce, setReocrPollNonce] = useState(0); // batch-käivitusel taaskäivitab poll-effecti

  // Teose kustutamine
  const [deleteWorkConfirm, setDeleteWorkConfirm] = useState(false);
  const [deleteWorkInput, setDeleteWorkInput] = useState('');
  const [deletingWork, setDeletingWork] = useState(false);
  const [deleteWorkError, setDeleteWorkError] = useState<string | null>(null);

  // Pildi HMAC token piiratud teoste allalaadimiseks
  const [imageToken, setImageToken] = useState<{ exp: number; sig: string } | null>(null);
  const [editorTarget, setEditorTarget] = useState<{ index: number; tab: 'edit' | 'split' } | null>(null);

  const MIN_COLS = 3;
  const MAX_COLS = 10;
  const [gridCols, setGridCols] = useState(5);

  const isAdmin = isAtLeast(user?.role, 'admin');

  useEffect(() => {
    if (user && !isAdmin) {
      navigate(`/work/${workId}/1`);
    }
  }, [user, isAdmin, workId, navigate]);

  const loadPages = async (): Promise<string[]> => {
    if (!workId || !authToken) return [];
    setLoading(true);
    setLoadError(null);
    try {
      const data = await getWorkPages(workId, authToken);
      if (data.status === 'success') {
        const loaded: PageInfo[] = data.pages || [];
        setPages(loaded);
        return loaded.map(p => p.lehekylje_pilt.split('/').pop() ?? '');
      } else {
        setLoadError(t('manage.loadError'));
      }
    } catch (e) {
      setLoadError(t('manage.loadError'));
    } finally {
      setLoading(false);
    }
    return [];
  };

  const loadTrashPages = async () => {
    if (!workId || !authToken) return;
    setTrashLoading(true);
    setTrashError(null);
    try {
      const data = await getDeletedWorkPages(workId, authToken);
      if (data.status === 'success') {
        setTrashPages(data.pages || []);
        setTrashLoaded(true);
      } else {
        setTrashError(t('manage.trash.loadError'));
      }
    } catch {
      setTrashError(t('manage.trash.loadError'));
    } finally {
      setTrashLoading(false);
    }
  };


  useEffect(() => {
    if (!workId || !authToken) return;
    getWorkMetadata(workId, authToken)
      .then(d => {
        if (d.status === 'success') {
          setWorkTitle(d.metadata?.title || workId || '');
          // OCR-mudel tuletatakse teose tüübist (Q87167 = käsikiri → hand, muidu print),
          // sama loogika nagu upload_ops.py. Eraldi mudeli-valikut UI-s pole.
          setOcrModel(d.metadata?.type?.id === 'Q87167' ? 'hand' : 'print');
        }
      })
      .catch(() => {});
  }, [workId, authToken]);

  useEffect(() => {
    if (isAdmin) loadPages();
  }, [workId, authToken, isAdmin]);

  // Pildi viewer-token piiratud teoste thumbnailide jaoks. Server-tokeni TTL on 1h
  // (public.py), seega värskendame seda perioodiliselt — muidu aeguks token pikalt
  // lahti oleval manage-lehel ja thumbid jääksid 403-lõputusse retry'sse (token on
  // src-is, PageThumb ei küsi seda ise uuesti). Värske token → src muutub → reload.
  useEffect(() => {
    if (!workId || !authToken || !isAdmin) return;
    let cancelled = false;
    const fetchToken = () => {
      getViewerToken(workId, authToken)
        .then(d => {
          if (!cancelled && d?.image_exp && d?.image_sig) {
            setImageToken({ exp: d.image_exp, sig: d.image_sig });
          }
        })
        .catch(() => {});
    };
    fetchToken();
    const timer = setInterval(fetchToken, 45 * 60 * 1000); // 45 min < 1h TTL
    return () => { cancelled = true; clearInterval(timer); };
  }, [workId, authToken, isAdmin]);

  // Re-OCR koondstaatus: laeb korra (näitab .ocr-ootel märke), pollib ainult aktiivse batchi ajal.
  useEffect(() => {
    if (!workId || !authToken) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let cancelled = false;

    const tick = async () => {
      try {
        const data = await getReocrStatus<ReocrStatusResponse>(workId, authToken);
        if (!cancelled) setReocrStatus(data);
        if (!cancelled && data.progress && data.progress.active) {
          timer = setTimeout(tick, 4000);
        }
      } catch (e) {
        // HTTP vead (nt 401/403 aegunud token, 404 puuduv teos) on lõplikud:
        // ära tee taustal lõputut ebaõnnestunud pollimist. Võrgu/timeout'i viga proovi uuesti.
        if (!cancelled && !(e instanceof ApiError)) timer = setTimeout(tick, 6000);
      }
    };
    tick();
    return () => { cancelled = true; if (timer) clearTimeout(timer); };
  }, [workId, authToken, reocrPollNonce]);

  useEffect(() => {
    const init: Record<string, number> = {};
    pages.forEach(p => { init[p.filename] = p.page_num; });
    setDraftPositions(init);
  }, [pages]);

  const hasReorderChanges = pages.some(p => draftPositions[p.filename] !== p.page_num);

  // Nähtav (effective) järjekord: draft kui olemas, muidu serveri page_num.
  // Iga lehe nähtav number on tema indeks selles järjestuses + 1.
  // useMemo: tagab stabiilse identiteedi, et fookus-effect ei käivitu iga renderi järel.
  const visibleSorted = useMemo(() => {
    return [...pages].sort(
      (a, b) => (draftPositions[a.filename] ?? a.page_num) - (draftPositions[b.filename] ?? b.page_num)
    );
  }, [pages, draftPositions]);

  const visiblePages: VisiblePage[] = useMemo(() => {
    return visibleSorted.map((p, i) => ({ filename: p.filename, visiblePageNum: i + 1 }));
  }, [visibleSorted]);

  const visibleNumByFile: Record<string, number> = useMemo(() => {
    const map: Record<string, number> = {};
    visiblePages.forEach((vp) => { map[vp.filename] = vp.visiblePageNum; });
    return map;
  }, [visiblePages]);

  // Fookus-effect: kerib ja tõstab esile fookus-kaardi ainult esmasel laadimisel.
  // handledFocusRef guard väldib korduvat kerimist ka React StrictMode kahekordse
  // effect-käivituse ja kasutaja hilisemate järjekorra-muudatuste korral.
  useEffect(() => {
    if (focus == null) return;
    if (loading) return;                           // oota kuni lehed laetud
    if (handledFocusRef.current === focus) return; // ainult kord (sh StrictMode)
    // Kontrolli, et fookus-leht on nähtavas listis
    const exists = Object.values(visibleNumByFile).includes(focus);
    if (!exists) { handledFocusRef.current = focus; return; }
    handledFocusRef.current = focus;
    // Keri pärast renderit (aspect-[3/4] → kõrgused stabiilsed, üks rAF piisab)
    requestAnimationFrame(() => {
      focusedCardRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
    setHighlightedNum(focus);
    const tid = setTimeout(() => setHighlightedNum(null), 2000);
    return () => clearTimeout(tid);
  }, [focus, loading, visibleNumByFile]);

  // Mitme lehe asukoht erineb salvestatud (serveri) järjekorrast
  const changedCount = pages.filter((p) => (draftPositions[p.filename] ?? p.page_num) !== p.page_num).length;

  // Liigutamise eelvaade/valideerimine (sama util mis submit)
  const moveResult = selectedFiles.size > 0
    ? computeBlockMoveOrder(visiblePages, selectedFiles, moveTarget)
    : null;

  // Vea-vihje (selgitab, miks "Liiguta" on keelatud). Positiivset eelvaadet ei kuva —
  // ruudustik ise on WYSIWYG eelvaade. JSX-i pesastatud narrowing ei tööta usaldusväärselt,
  // seega arvuta tekst komponendi kehas (`in`-operaator kitsendab usaldusväärselt).
  let moveHintText: string | null = null;
  if (moveResult && 'reason' in moveResult) {
    if (moveResult.reason === 'anchorInSelection') {
      moveHintText = t('manage.move.anchorInSelection', { end: pages.length + 1 });
    } else if (moveResult.reason === 'invalidTarget') {
      moveHintText = t('manage.move.invalidTarget');
    }
  }

  // Hõljuv alumine tegevusriba nähtav ainult lehekülgede tabis, kui on valik
  // VÕI salvestamata järjekorra-muudatus. Kasutatakse nii sisu alaserva padding'uks
  // (et viimane pisipiltide rida ei jää riba taha) kui riba renderdamiseks.
  const showActionBar = activeTab === 'pages' && (selectedFiles.size > 0 || hasReorderChanges);

  // Vali/tühista; shift = vahemik viimasest ankrust nähtaval järjekorral
  const handleToggle = (filename: string, shiftKey: boolean) => {
    const idx = visiblePages.findIndex((vp) => vp.filename === filename);
    // Loe ankur ENNE setState'i: updater jookseb hiljem (render-faasis), aga
    // lastSelectedIndexRef.current kirjutatakse üle juba allpool — kui updater loeks
    // refi laisalt, näeks ta uut idx-i ja vahemik kahaneks üheks elemendiks.
    const anchor = lastSelectedIndexRef.current;
    setSelectedFiles((prev) => {
      const next = new Set(prev);
      if (shiftKey && anchor !== null) {
        const [lo, hi] = [anchor, idx].sort((a, b) => a - b);
        for (let i = lo; i <= hi; i++) next.add(visiblePages[i].filename);
      } else {
        if (next.has(filename)) next.delete(filename); else next.add(filename);
      }
      return next;
    });
    lastSelectedIndexRef.current = idx;
  };

  const handleSelectAll = () => setSelectedFiles(new Set(pages.map((p) => p.filename)));
  const handleClearSelection = () => { setSelectedFiles(new Set()); lastSelectedIndexRef.current = null; };

  const handleSelectNoText = () =>
    setSelectedFiles(new Set(selectableNoTextFiles(pages, reocrStatus)));

  const selectedWithTextCount = Array.from(selectedFiles)
    .filter((fn) => pages.find((p) => p.filename === fn)?.has_text).length;

  const handleBatchReocr = async () => {
    if (!workId || !authToken || selectedFiles.size === 0) return;
    setBatchError(null);
    try {
      await startReocrBatch(workId, authToken, {
        page_filenames: Array.from(selectedFiles),
        material_type: ocrModel,
      });
      setBatchConfirm(false);
      handleClearSelection();
      // Nonce bump taaskäivitab poll-effecti (alustab pollimist), mis teeb ise status-fetchi
      setReocrPollNonce((n) => n + 1);
    } catch (e: any) {
      setBatchError(e.message || t('manage.reocr.error'));
    }
  };

  // Liiguta plokk: kirjuta uus order draftPositions-i (ei salvesta veel serverisse)
  const handleMove = () => {
    if (!moveResult || !moveResult.ok) return;
    const next: Record<string, number> = {};
    moveResult.order.forEach((fn, i) => { next[fn] = i + 1; });
    setDraftPositions(next);
    setMoveTarget('');
    // valik jääb alles (samad failid, uues asukohas)
  };

  // Tühista kõik salvestamata järjekorra muudatused
  const applyDiscardReorder = () => {
    const init: Record<string, number> = {};
    pages.forEach((p) => { init[p.filename] = p.page_num; });
    setDraftPositions(init);
    setDiscardConfirmOpen(false);
  };

  const handleDiscardReorder = () => {
    if (changedCount > 2) { setDiscardConfirmOpen(true); return; }
    applyDiscardReorder();
  };

  /**
   * Salvestab järjekorra ILMA kinnituseta. Kasutab nii nupu-handler (mis küsib
   * kinnituse enne) kui ka salvestamata muudatuste dialoog — muidu hüppaks
   * dialoogi "Salvesta ja jätka" peale teine kinnitus ette.
   *
   * Tagastab `true` ainult siis, kui salvestus õnnestus.
   */
  const saveReorder = async (): Promise<boolean> => {
    if (!workId || !authToken) return false;
    setReorderConfirmOpen(false);

    // Sorteeri pages draftPositions järgi, võta filename järjekord
    const sorted = [...pages].sort((a, b) => {
      const pa = draftPositions[a.filename] ?? a.page_num;
      const pb = draftPositions[b.filename] ?? b.page_num;
      return pa - pb;
    });
    const order = sorted.map(p => p.filename);

    setReorderSaving(true);
    setReorderError(null);
    try {
      await reorderWorkPages(workId, authToken, order);
      await loadPages();
      // Salvestus = commit → tühjenda valik (uue protsessi eeldus). NB: Liiguta
      // (mustand) EI tühjenda, et saaks sama plokki uuesti liigutada.
      handleClearSelection();
      return true;
    } catch (e: any) {
      setReorderError(e.message || t('manage.reorderError'));
      return false;
    } finally {
      setReorderSaving(false);
    }
  };

  const handleReorderSave = () => { setReorderConfirmOpen(true); };

  // Salvestamata järjekorra mustand on samasugune salvestamata muudatus nagu tekst.
  // NB: `saveReorder` (mitte `handleReorderSave`) — dialoog ei tohi küsida teist
  // kinnitust "Salvesta ja jätka" peale.
  const { dialogProps } = useUnsavedChangesGuard({
    isDirty: changedCount > 0,
    onSave: saveReorder,
  });

  const handleBulkDelete = async () => {
    if (!workId || !authToken || selectedFiles.size === 0) return;
    // base_name = pildifaili nimi ilma laiendita
    const baseNames = Array.from(selectedFiles).map((fn) => {
      const img = pages.find((p) => p.filename === fn)?.lehekylje_pilt.split('/').pop() ?? fn;
      return img.replace(/\.[^.]+$/, '');
    });
    setBulkDeleting(true);
    setBulkDeleteError(null);
    try {
      await deleteWorkPages(workId, authToken, baseNames);
      await loadPages();
      if (trashLoaded) loadTrashPages();
      setSelectedFiles(new Set());
      setBulkDeleteConfirm(false);
    } catch (e: any) {
      if (e instanceof ApiError && e.status === 409) {
        setBulkDeleteError(t('manage.bulkDelete.conflict'));
        await loadPages();
        setSelectedFiles(new Set());
      } else {
        setBulkDeleteError(e.message || t('manage.deletePageError'));
      }
    } finally {
      setBulkDeleting(false);
    }
  };

  // Asendab ühe lehe pildi. Viskab vea edasi, et kutsuja (redaktori-modaal)
  // saaks oma UI-s vea näidata ja eelvaadet mitte värskendada.
  const handleReplaceImage = async (file: File, pageNum: number) => {
    if (!workId || !authToken) throw new Error('Not authorized');
    setReplaceError(null);

    const data = await replaceWorkPageImage(workId, authToken, pageNum, file);
    if (data.status !== 'success') throw new Error(t('manage.replaceError'));

    // Õnnestus: cache-bust + sessionStorage (Workspace tühistab cache'i) + lehtede uuesti laadimine
    setThumbCacheBust(Date.now());
    setReplaceSuccess(t('manage.replaceSuccess', { num: pageNum }));
    setTimeout(() => setReplaceSuccess(null), 4000);
    try {
      const key = `${workId}/${pageNum}`;
      const existing = JSON.parse(sessionStorage.getItem('vutt_replaced_images') || '{}');
      existing[key] = Date.now();
      sessionStorage.setItem('vutt_replaced_images', JSON.stringify(existing));
    } catch { /* ignore storage errors */ }

    await loadPages();
  };

  const handleAddPage = async () => {
    if (!workId || !authToken || addFiles.length === 0) return;
    setAddingPage(true);
    setAddPageError(null);
    cancelRef.current = false;

    const sorted = [...addFiles].sort((a, b) => naturalCompare(a.name, b.name));
    // Iga tükk on backendis eraldi git-commit (tükkide-ülest atomaarsust ei ole):
    // vahepealse tüki viga jätab varasemad tükid sisse → kuvame addPagesPartialError.
    const chunks = planChunks(sorted, addAfterPage, CHUNK_MAX_FILES, CHUNK_MAX_BYTES);
    const total = sorted.length;
    let done = 0;
    let meiliWarned = false;
    setUploadProgress({ done: 0, total });

    try {
      for (const chunk of chunks) {
        // Tühistus on tüki-granulaarne: parajasti pooleliolev tükk jõuab veel
        // serverisse committida; katkestus rakendub alles järgmise tüki ees.
        if (cancelRef.current) break;
        const data = await addWorkPages(workId, authToken, chunk.files, chunk.afterPageNum);
        if (data.meili_warning) meiliWarned = true;
        done += chunk.files.length;
        setUploadProgress({ done, total });
      }

      await loadPages();
      if (!cancelRef.current) {
        setShowAddForm(false);
        setAddFiles([]);
        setAddAfterPage(-1);
        if (fileInputRef.current) fileInputRef.current.value = '';
      }
      if (meiliWarned && !cancelRef.current) setAddPageError(t('manage.addPagesMeiliWarning'));
    } catch (e: any) {
      await loadPages(); // peegelda osaline tulemus
      setAddPageError(t('manage.addPagesPartialError', { added: done, error: e.message }));
    } finally {
      setUploadProgress(null);
      setAddingPage(false);
    }
  };

  const handleRestorePage = async (filename: string) => {
    if (!workId || !authToken) return;
    setRestoringPage(filename);
    setRestoreMessage(null);
    try {
      const data = await restoreDeletedWorkPage(workId, authToken, filename);
      if (data.status === 'success') {
        setRestoreMessage({ text: t('manage.trash.restoreSuccess', { name: filename }), ok: true });
        setTrashPages(prev => prev.filter(p => p.filename !== filename));
        // Uuenda lehekülgede nimekirja
        await loadPages();
      } else {
        setRestoreMessage({ text: `${t('manage.trash.restoreError')}: ${data.detail || data.message || ''}`, ok: false });
      }
    } catch {
      setRestoreMessage({ text: t('manage.trash.restoreError'), ok: false });
    } finally {
      setRestoringPage(null);
    }
  };

  const handleDeleteWork = async () => {
    if (!workId || !authToken) return;
    setDeletingWork(true);
    setDeleteWorkError(null);
    try {
      await deleteWork(workId, authToken);
      navigate('/');
    } catch {
      setDeleteWorkError(t('management.deleteWorkError'));
    } finally {
      setDeletingWork(false);
    }
  };

  if (!user) {
    return (
      <div className="min-h-screen bg-gray-50">
        <Header />
        <div className="flex items-center justify-center mt-24">
          <p className="text-gray-500">{t('common:errors.notLoggedIn', 'Logi sisse')}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <Header />

      <div className={`max-w-4xl mx-auto px-4 py-8 ${showActionBar ? 'pb-36' : ''}`}>

        {/* Navigatsioon tagasi */}
        <div className="flex items-center gap-3 mb-6">
          <button
            onClick={() => navigate(buildBackToEditorPath(workId!, focus))}
            className="flex items-center gap-1.5 text-sm text-gray-600 hover:text-gray-900 transition-colors"
          >
            <ArrowLeft size={16} />
            {focus != null ? t('manage.backToPage', { n: focus }) : t('manage.backToWork')}
          </button>
        </div>

        {/* Pealkiri */}
        <div className="flex items-center gap-3 mb-6">
          <div className="p-2 bg-amber-100 rounded-lg">
            <Wrench size={20} className="text-amber-600" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-gray-900">{t('manage.title')}</h1>
            {workTitle && (
              <p className="text-sm text-gray-500 mt-0.5">{workTitle}</p>
            )}
          </div>
        </div>

        {/* Tabid */}
        <div className="flex gap-1 mb-6 border-b border-gray-200">
          <button
            onClick={() => setActiveTab('pages')}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
              activeTab === 'pages'
                ? 'border-primary-600 text-primary-700'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            {t('manage.tabPages')}
            {pages.length > 0 && (
              <span className="ml-1.5 text-xs bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded-full">
                {pages.length}
              </span>
            )}
          </button>
          <button
            onClick={() => setActiveTab('replace')}
            className={`flex items-center gap-1.5 px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
              activeTab === 'replace'
                ? 'border-primary-600 text-primary-700'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            <RefreshCw size={14} />
            {t('manage.tabs.replace', 'Asenda leheküljed')}
          </button>
          <button
            onClick={() => {
              setActiveTab('trash');
              if (!trashLoaded) loadTrashPages();
            }}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
              activeTab === 'trash'
                ? 'border-primary-600 text-primary-700'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            {t('manage.tabTrash')}
            {trashLoaded && trashPages.length > 0 && (
              <span className="ml-1.5 text-xs bg-red-100 text-red-600 px-1.5 py-0.5 rounded-full">
                {trashPages.length}
              </span>
            )}
          </button>
        </div>

        {/* TAB: Leheküljed */}
        {activeTab === 'pages' && (
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm mb-6">
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
              <h2 className="font-semibold text-gray-800">{t('manage.pages')}</h2>
              <div className="flex items-center gap-3">
                {pages.length > 0 && selectedFiles.size < pages.length && (
                  <button onClick={handleSelectAll}
                    className="px-2 py-1 text-xs border border-gray-300 text-gray-600 rounded hover:bg-gray-50">
                    {t('manage.select.all')}
                  </button>
                )}
                {pages.length > 0 && (
                  <button onClick={handleSelectNoText}
                    className="px-2 py-1 text-xs border border-amber-300 text-amber-700 rounded hover:bg-amber-50">
                    {t('manage.reocr.selectNoText')}
                  </button>
                )}
                <span className="text-sm text-gray-500">{pages.length} {t('manage.pagesCount', { count: pages.length })}</span>
              </div>
            </div>

            {loading ? (
              <div className="flex items-center justify-center py-12 text-gray-400">
                <Loader2 size={24} className="animate-spin mr-2" />
                <span>{t('common:labels.loading')}</span>
              </div>
            ) : loadError ? (
              <div className="flex items-center gap-2 p-5 text-red-600">
                <AlertTriangle size={16} />
                <span className="text-sm">{loadError}</span>
              </div>
            ) : pages.length === 0 ? (
              <p className="p-5 text-sm text-gray-400">{t('manage.noPages')}</p>
            ) : (
              <>
                {/* Valiku/järjekorra tegevused on hõljuvas alumises ribas (PageActionBar) */}

                {/* Progress-kokkuvõte */}
                {reocrStatus?.progress && reocrStatus.progress.total > 0 && (
                  <div className="mx-4 mb-2 text-sm text-green-700">
                    {t('manage.reocr.progress', {
                      ready: reocrStatus.progress.ready,
                      total: reocrStatus.progress.total,
                      errors: reocrStatus.progress.errors,
                    })}
                  </div>
                )}

                <div className="flex items-center gap-2 px-4 pt-2 text-sm text-gray-600">
                  <button
                    onClick={() => setGridCols((c) => Math.min(c + 1, MAX_COLS))}
                    disabled={gridCols >= MAX_COLS}
                    className="px-2 py-0.5 border rounded disabled:opacity-40"
                    title={t('thumbnails.smaller')}
                  >−</button>
                  <input
                    type="range"
                    min={MIN_COLS}
                    max={MAX_COLS}
                    value={MAX_COLS + MIN_COLS - gridCols}
                    onChange={(e) => setGridCols(MAX_COLS + MIN_COLS - Number(e.target.value))}
                    aria-label={t('thumbnails.columns')}
                  />
                  <button
                    onClick={() => setGridCols((c) => Math.max(c - 1, MIN_COLS))}
                    disabled={gridCols <= MIN_COLS}
                    className="px-2 py-0.5 border rounded disabled:opacity-40"
                    title={t('thumbnails.larger')}
                  >+</button>
                </div>
                <div
                  className="grid gap-3 p-4"
                  style={{ gridTemplateColumns: `repeat(${gridCols}, 1fr)` }}
                >
                  {visibleSorted.map((page) => {
                    const vNum = visibleNumByFile[page.filename];
                    const isFocused = focus != null && vNum === focus;
                    return (
                      <PageCard
                        key={page.filename}
                        ref={isFocused ? focusedCardRef : undefined}
                        isFocused={isFocused && highlightedNum === focus}
                        workId={workId!}
                        filename={page.filename}
                        imageName={page.lehekylje_pilt.split('/').pop() ?? ''}
                        visiblePageNum={vNum}
                        status={page.status}
                        hasText={page.has_text}
                        reocrState={mapReocrState(page.filename, reocrStatus)}
                        isSelected={selectedFiles.has(page.filename)}
                        isChanged={(draftPositions[page.filename] ?? page.page_num) !== page.page_num}
                        thumbCacheBust={thumbCacheBust}
                        imageToken={imageToken}
                        onToggle={handleToggle}
                        onEdit={() => setEditorTarget({ index: page.page_num - 1, tab: 'edit' })}
                      />
                    );
                  })}
                </div>
              </>
            )}

            {reorderError && (
              <div className="mx-5 mb-2 mt-3 p-3 bg-red-50 border border-red-200 rounded text-sm text-red-700">
                {reorderError}
              </div>
            )}


            {replaceSuccess && (
              <div className="mx-5 mb-4 p-3 bg-green-50 border border-green-200 rounded text-sm text-green-700">
                {replaceSuccess}
              </div>
            )}

            {replaceError && (
              <div className="mx-5 mb-4 p-3 bg-red-50 border border-red-200 rounded text-sm text-red-700">
                {replaceError}
              </div>
            )}

            {/* Lisa leht */}
            <div className="px-5 py-4 border-t border-gray-100">
              {!showAddForm ? (
                <button
                  onClick={() => setShowAddForm(true)}
                  className="flex items-center gap-2 px-3 py-1.5 text-sm bg-primary-600 hover:bg-primary-700 text-white rounded transition-colors"
                >
                  <Plus size={15} />
                  {t('manage.addPage')}
                </button>
              ) : (
                <div className="bg-gray-50 border border-gray-200 rounded-lg p-4 space-y-3">
                  <h3 className="text-sm font-semibold text-gray-700">{t('manage.addPageTitle')}</h3>

                  <div>
                    <label className="text-xs text-gray-500 block mb-1">{t('manage.addPageFile')}</label>
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="image/jpeg,image/png"
                      multiple
                      disabled={addingPage}
                      onChange={(e) => {
                        const list = Array.from(e.target.files || []);
                        list.sort((a, b) => naturalCompare(a.name, b.name));
                        setAddFiles(list);
                        setShowAllNames(false);
                      }}
                      className="text-sm text-gray-700"
                    />
                    {addFiles.length > 1 && (
                      <p className="text-xs text-gray-500 mt-1">
                        {t('manage.addPagesFilesSelected', { count: addFiles.length })}
                      </p>
                    )}
                  </div>

                  <div>
                    <label className="text-xs text-gray-500 block mb-1">{t('manage.addPagePosition')}</label>
                    <select
                      value={addAfterPage}
                      onChange={(e) => setAddAfterPage(Number(e.target.value))}
                      disabled={addingPage}
                      className="text-sm border border-gray-300 rounded px-2 py-1 focus:outline-none focus:ring-2 focus:ring-primary-500 bg-white"
                    >
                      <option value={0}>{t('manage.addPageToBeginning')}</option>
                      {pages.map((p) => (
                        <option key={p.page_num} value={p.page_num}>
                          {t('manage.addPageAfter', { num: p.page_num })}
                        </option>
                      ))}
                      <option value={-1}>{t('manage.addPageToEnd')}</option>
                    </select>
                  </div>

                  {addFiles.length > 1 && (
                    <div className="text-xs text-gray-600">
                      <p className="font-medium mb-1">{t('manage.addPagesPreview')}</p>
                      <ol className="list-decimal list-inside space-y-0.5">
                        {(showAllNames || addFiles.length <= 15
                          ? addFiles
                          : [...addFiles.slice(0, 10), ...addFiles.slice(-5)]
                        ).map((f, i) => <li key={i} className="truncate">{f.name}</li>)}
                      </ol>
                      {addFiles.length > 15 && (
                        <button
                          type="button"
                          onClick={() => setShowAllNames((v) => !v)}
                          className="mt-1 text-primary-600 hover:underline"
                        >
                          {showAllNames
                            ? t('manage.addPagesShowLess')
                            : t('manage.addPagesShowAll', { count: addFiles.length })}
                        </button>
                      )}
                    </div>
                  )}

                  {addPageError && (
                    <p className="text-sm text-red-600">{addPageError}</p>
                  )}

                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      onClick={handleAddPage}
                      disabled={addFiles.length === 0 || addingPage}
                      className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-primary-600 hover:bg-primary-700 disabled:opacity-40 text-white rounded transition-colors"
                    >
                      {addingPage ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
                      {addFiles.length > 1
                        ? t('manage.addPagesSubmitMulti', { count: addFiles.length })
                        : t('manage.addPageSubmit')}
                    </button>
                    <button
                      onClick={() => { setShowAddForm(false); setAddFiles([]); setAddPageError(null); if (fileInputRef.current) fileInputRef.current.value = ''; }}
                      className="px-3 py-1.5 text-sm border border-gray-300 text-gray-600 rounded hover:bg-gray-50 transition-colors"
                    >
                      {t('common:buttons.cancel', 'Tühista')}
                    </button>
                    {uploadProgress && (
                      <div className="flex items-center gap-3 text-sm text-gray-600">
                        <span>{t('manage.addPagesProgress', uploadProgress)}</span>
                        <button
                          type="button"
                          onClick={() => { cancelRef.current = true; }}
                          className="text-red-600 hover:underline"
                        >
                          {t('manage.addPagesCancel')}
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* TAB: Prügikast */}
        {activeTab === 'trash' && (
          <>
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm mb-6">
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
              <h2 className="font-semibold text-gray-800">{t('manage.tabTrash')}</h2>
              <button
                onClick={loadTrashPages}
                disabled={trashLoading}
                className="text-xs px-3 py-1 bg-gray-100 hover:bg-gray-200 disabled:opacity-50 rounded text-gray-600 flex items-center gap-1"
              >
                {trashLoading ? <Loader2 size={12} className="animate-spin" /> : <RotateCcw size={12} />}
                {t('manage.trash.load')}
              </button>
            </div>

            {restoreMessage && (
              <div className={`mx-5 mt-4 p-3 rounded text-sm border ${
                restoreMessage.ok
                  ? 'bg-green-50 border-green-200 text-green-700'
                  : 'bg-red-50 border-red-200 text-red-700'
              }`}>
                {restoreMessage.text}
              </div>
            )}

            {trashError && (
              <div className="mx-5 mt-4 p-3 bg-red-50 border border-red-200 rounded text-sm text-red-700">
                {trashError}
              </div>
            )}

            {trashLoading && (
              <div className="flex items-center justify-center py-12 text-gray-400">
                <Loader2 size={24} className="animate-spin mr-2" />
                <span>{t('common:labels.loading')}</span>
              </div>
            )}

            {!trashLoading && trashLoaded && trashPages.length === 0 && (
              <p className="p-5 text-sm text-gray-400">{t('manage.trash.empty')}</p>
            )}

            {!trashLoading && trashPages.length > 0 && (
              <div className="divide-y divide-gray-100">
                {trashPages.map((page) => (
                  <div key={page.filename} className="flex items-center gap-3 px-5 py-3">
                    <div className="flex-shrink-0 text-gray-300">
                      <FileImage size={20} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-700 font-mono">{page.filename}</p>
                      {page.deleted_at && (
                        <p className="text-xs text-gray-400 mt-0.5">
                          {t('manage.trash.deletedAt')}: {new Date(page.deleted_at).toLocaleString('et-EE', {
                            day: '2-digit', month: '2-digit', year: 'numeric',
                            hour: '2-digit', minute: '2-digit'
                          })}
                          {page.deleted_by && ` · ${page.deleted_by}`}
                        </p>
                      )}
                    </div>
                    <button
                      onClick={() => handleRestorePage(page.filename)}
                      disabled={restoringPage === page.filename}
                      className="flex-shrink-0 flex items-center gap-1.5 px-3 py-1.5 text-sm bg-primary-600 hover:bg-primary-700 text-white rounded transition-colors disabled:opacity-50"
                    >
                      {restoringPage === page.filename ? (
                        <><Loader2 size={13} className="animate-spin" />{t('manage.trash.restoring')}</>
                      ) : (
                        <><RotateCcw size={13} />{t('manage.trash.restore')}</>
                      )}
                    </button>
                  </div>
                ))}
              </div>
            )}

            {!trashLoaded && !trashLoading && !trashError && (
              <div className="p-5 text-center">
                <button
                  onClick={loadTrashPages}
                  className="px-4 py-2 text-sm bg-gray-100 hover:bg-gray-200 text-gray-700 rounded transition-colors"
                >
                  {t('manage.trash.load')}
                </button>
              </div>
            )}
          </div>

          {/* Ohutsoon — prügikasti tabi all */}
          <div className="bg-white rounded-xl border border-red-200 shadow-sm">
          <div className="flex items-center gap-2 px-5 py-4 border-b border-red-100">
            <AlertTriangle size={16} className="text-red-500" />
            <h2 className="font-semibold text-red-800">{t('manage.dangerZone')}</h2>
          </div>
          <div className="p-5">
            {!deleteWorkConfirm ? (
              <button
                onClick={() => { setDeleteWorkConfirm(true); setDeleteWorkInput(''); }}
                className="px-3 py-1.5 text-sm border border-red-300 text-red-600 rounded hover:bg-red-50 transition-colors"
              >
                {t('management.deleteWork')}
              </button>
            ) : (
              <div className="bg-red-50 border border-red-200 rounded p-4 space-y-3">
                <p className="text-sm text-red-800">
                  {t('management.deleteWorkConfirmMessage', { title: workTitle || workId })}
                </p>
                <input
                  type="text"
                  value={deleteWorkInput}
                  onChange={(e) => setDeleteWorkInput(e.target.value)}
                  placeholder={t('management.deleteWorkInputPlaceholder', { word: t('management.deleteWorkConfirmWord') })}
                  className="w-full px-3 py-2 text-sm border border-red-200 rounded focus:outline-none focus:ring-2 focus:ring-red-500 bg-white"
                  autoFocus
                />
                {deleteWorkError && (
                  <p className="text-sm text-red-600 font-medium">{deleteWorkError}</p>
                )}
                <div className="flex gap-2">
                  <button
                    onClick={handleDeleteWork}
                    disabled={deletingWork || deleteWorkInput !== t('management.deleteWorkConfirmWord')}
                    className="px-3 py-1.5 text-sm bg-red-600 text-white rounded hover:bg-red-700 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                  >
                    {deletingWork ? <Loader2 size={14} className="animate-spin inline" /> : t('management.deleteWorkConfirm')}
                  </button>
                  <button
                    onClick={() => { setDeleteWorkConfirm(false); setDeleteWorkError(null); setDeleteWorkInput(''); }}
                    className="px-3 py-1.5 text-sm border border-gray-300 text-gray-600 rounded hover:bg-gray-50 transition-colors"
                  >
                    {t('management.deleteWorkCancel')}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
          </>
        )}

        {/* TAB: Asenda leheküljed */}
        {activeTab === 'replace' && (
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm mb-6">
            <div className="flex items-center gap-2 px-5 py-4 border-b border-gray-100">
              <RefreshCw size={16} className="text-gray-500" />
              <h2 className="font-semibold text-gray-800">{t('manage.tabs.replace', 'Asenda leheküljed')}</h2>
            </div>
            <div className="p-5 space-y-4">
              <p className="text-sm text-gray-600">
                {t('manage.replaceHint')}
              </p>
              <div className="flex items-start gap-2 p-3 bg-amber-50 border border-amber-200 rounded-lg">
                <AlertTriangle size={15} className="text-amber-600 shrink-0 mt-0.5" />
                <p className="text-sm text-amber-800">
                  {t('manage.replaceWarning')}
                </p>
              </div>
              <button
                onClick={() =>
                  navigate(`/upload?replaceWorkId=${workId}&replaceWorkTitle=${encodeURIComponent(workTitle || workId || '')}`)
                }
                className="flex items-center gap-2 px-4 py-2 bg-primary-600 hover:bg-primary-700 text-white text-sm font-medium rounded-lg transition-colors"
              >
                <Upload size={15} />
                {t('manage.openUploadWizard')}
              </button>
            </div>
          </div>
        )}

      </div>

      {/* Lehe pildiredaktor (pööra/kärbi + poolita) */}
      {editorTarget && (
        <PageImageEditorModal
          workId={workId!}
          pages={pages.map(p => ({ filename: p.lehekylje_pilt.split('/').pop() ?? '', page_num: p.page_num }))}
          initialIndex={editorTarget.index}
          initialTab={editorTarget.tab}
          imageToken={imageToken}
          onClose={() => setEditorTarget(null)}
          onPagesChanged={async () => {
            const fresh = await loadPages();
            setThumbCacheBust(Date.now());
            return fresh;
          }}
          onReplaceImage={handleReplaceImage}
          cacheBust={thumbCacheBust}
        />
      )}

      {/* Hõljuv alumine kontekstiriba (valik + järjekorra tegevused) */}
      {activeTab === 'pages' && (
        <PageActionBar
          selectedCount={selectedFiles.size}
          onClearSelection={handleClearSelection}
          moveTarget={moveTarget}
          setMoveTarget={setMoveTarget}
          moveCanApply={moveTarget.trim() !== '' && !!(moveResult && moveResult.ok)}
          moveHintText={moveHintText}
          onMove={handleMove}
          actionsDisabled={hasReorderChanges}
          actionsDisabledTitle={t('manage.bulkDelete.draftBlocked')}
          onReocrClick={() => setBatchConfirm(true)}
          batchConfirm={batchConfirm}
          selectedWithTextCount={selectedWithTextCount}
          onBatchGo={handleBatchReocr}
          onBatchCancel={() => setBatchConfirm(false)}
          batchError={batchError}
          onDeleteClick={() => setBulkDeleteConfirm(true)}
          bulkDeleteConfirm={bulkDeleteConfirm}
          bulkDeleting={bulkDeleting}
          onBulkDeleteGo={handleBulkDelete}
          onBulkDeleteCancel={() => setBulkDeleteConfirm(false)}
          bulkDeleteError={bulkDeleteError}
          hasReorderChanges={hasReorderChanges}
          changedCount={changedCount}
          reorderSaving={reorderSaving}
          onReorderSave={handleReorderSave}
          onDiscardReorder={handleDiscardReorder}
        />
      )}

      <ConfirmModal
        isOpen={discardConfirmOpen}
        title={t('manage.reorder.discardTitle')}
        message={t('manage.reorder.discardConfirm')}
        onConfirm={applyDiscardReorder}
        onCancel={() => setDiscardConfirmOpen(false)}
        variant="danger"
      />

      <ConfirmModal
        isOpen={reorderConfirmOpen}
        title={t('manage.reorderConfirmTitle')}
        message={t('manage.reorderConfirm')}
        onConfirm={() => { void saveReorder(); }}
        onCancel={() => setReorderConfirmOpen(false)}
      />

      <UnsavedChangesDialog {...dialogProps} />
    </div>
  );
};

export default WorkManage;
