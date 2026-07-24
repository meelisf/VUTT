import React, { useEffect, useMemo, useState, useCallback, useRef } from 'react';
import { isAtLeast } from '../utils/roleUtils';
import { useTranslation } from 'react-i18next';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { MeiliSearch } from 'meilisearch';
import { useUnsavedChangesGuard } from '../hooks/useUnsavedChangesGuard';
import { getPage, savePage } from '../services/pageService';
import { getWorkMetadata, getWorkPageImages } from '../services/workService';
import type { Page, Work } from '../types';
import { PageStatus } from '../types';
import ImageViewer from '../components/ImageViewer';
import ThumbnailGrid from '../components/ThumbnailGrid';
import TextEditor from '../components/TextEditor';
import ConfirmModal from '../components/ConfirmModal';
import LanguageSwitcher from '../components/LanguageSwitcher';
import { useUser } from '../contexts/UserContext';
import { useCollection } from '../contexts/CollectionContext';
import { useMeiliIndex } from '../contexts/MeilisearchContext';
import MetadataModal from '../components/MetadataModal';
import { ChevronLeft, ChevronRight, AlertTriangle, Search, LogIn, Copy, Check } from 'lucide-react';
import UserMenu from '../components/UserMenu';
import WorkspaceMobileView from '../components/mobile/WorkspaceMobileView';
import LoginModal from '../components/LoginModal';
import { getLabel } from '../utils/metadataUtils';
import { ErrorBanner } from '../components/ErrorBanner';
import { FILE_API_URL, MEILI_HOST, MEILI_INDEX } from '../config';
import { buildManageLink } from '../utils/manageDeeplink';

const Workspace: React.FC = () => {
  const { t } = useTranslation(['workspace', 'common', 'auth']);
  const { user, authToken, logout, sessionExpired, clearSessionExpired, isLoading: authInitializing } = useUser();
  const isAdmin = isAtLeast(user?.role, 'admin');
  const { collections, selectedCollection, setSelectedCollection } = useCollection();
  const index = useMeiliIndex();
  const [viewerToken, setViewerToken] = useState<string | null>(null);
  const [imageToken, setImageToken] = useState<{ exp: number; sig: string } | null>(null);
  const effectiveIndex = useMemo(() => {
    if (viewerToken) return new MeiliSearch({ host: MEILI_HOST, apiKey: viewerToken }).index(MEILI_INDEX);
    return index;
  }, [index, viewerToken]);
  const { workId, pageNum } = useParams<{ workId: string, pageNum: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const [loading, setLoading] = useState(true);
  // Lehe laadimine sama teose sees — ei võta editorit maha, näitab ainult riba.
  const [pageLoading, setPageLoading] = useState(false);
  // Viimati laetud teos. Eristab "teose vahetus" (spinner) ja "lehe vahetus
  // samas teoses" (raam jääb püsima).
  const loadedWorkIdRef = useRef<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [errorRequiresLogin, setErrorRequiresLogin] = useState(false);
  const [page, setPage] = useState<Page | null>(null);
  const [work, setWork] = useState<Work | undefined>(undefined);
  const [editorChanges, setEditorChanges] = useState(false);
  const [copied, setCopied] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const handleCopyPermalink = () => {
    if (!workId) return;
    const permalinkUrl = `${window.location.origin}/work/${workId}`;
    navigator.clipboard.writeText(permalinkUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const [currentStatus, setCurrentStatus] = useState<PageStatus | null>(null);
  const statusDirty = page && currentStatus ? currentStatus !== page.status : false;
  const hasUnsavedChanges = editorChanges || statusDirty;

  // Sünkroniseeri olekud kui leht vahetub
  useEffect(() => {
    setEditorChanges(false);
  }, [pageNum]);

  // Upload-viisardilt tulnud hoiatused (nt import õnnestus, aga Git commit mitte)
  // kuvatakse tööle jõudes ühekordselt ja eemaldatakse history state'ist.
  useEffect(() => {
    const uploadWarning = (location.state as { uploadWarning?: string } | null)?.uploadWarning;
    if (!uploadWarning) return;
    setSaveError(uploadWarning);
    navigate(`${location.pathname}${location.search}`, { replace: true, state: null });
  }, [location.pathname, location.search, location.state, navigate]);

  // Metaandmete muutmise modal
  const [isMetaModalOpen, setIsMetaModalOpen] = useState(false);

  // Salvestamata muudatuste kinnitusdialoogi olek
  const [pendingNavigation, setPendingNavigation] = useState<(() => void) | null>(null);
  const editorSaveRef = useRef<(() => Promise<void>) | null>(null);

  // Login modaali olek
  const [showLoginModal, setShowLoginModal] = useState(false);

  // Thumbnail grid-vaate olek
  const [isGridView, setIsGridView] = useState(false);
  const [gridPages, setGridPages] = useState<{ pageNum: number; imageUrl: string; hasAnnotations: boolean }[]>([]);
  const [gridLoading, setGridLoading] = useState(false);
  const [gridCols, setGridCols] = useState(5); // min 3, max 10 (vt ThumbnailGrid)

  const currentPageNum = parseInt(pageNum || '1', 10);

  // Lehekülje numbri sisestamise olek
  const [inputPage, setInputPage] = useState(pageNum || '1');

  // Sünkroniseeri sisendväli URL-i muutustega (nt nuppudega navigeerimisel)
  useEffect(() => {
    setInputPage(pageNum || '1');
  }, [pageNum]);

  // Sisselogitud kasutaja pildi HMAC token — laetakse üks kord teos kohta.
  // Vajalik piiratud kollektsioonide piltidele, kuna image server on eraldi server
  // ja auth credentials-eid ei saa <img src> päringuga kaasa saata.
  useEffect(() => {
    if (!authToken || !workId) return;
    setImageToken(null);
    fetch(`${FILE_API_URL}/work/${workId}/viewer-token`, {
      headers: { Authorization: `Bearer ${authToken}` },
    })
      .then(r => (r.ok ? r.json() : null))
      .then(data => {
        if (data?.image_exp && data?.image_sig) {
          setImageToken({ exp: data.image_exp, sig: data.image_sig });
        }
      })
      .catch(() => {});
  }, [workId, authToken]);

  // skipBlockerRef: tõese väärtuse korral ignoreerib blocker hasUnsavedChanges kontrolli
  // (kasutatakse "Salvesta ja lahku" ajal — navigeerimiseks pärast salvestamist)
  const skipBlockerRef = useRef(false);

  const { isBlocked, blockedLocation, proceed, reset } = useUnsavedChangesGuard(hasUnsavedChanges, skipBlockerRef);
  const isBlockerActive = isBlocked;

  const handlePageInputSubmit = () => {
    if (!workId) return;
    const newPage = parseInt(inputPage, 10);
    const totalPages = work?.page_count || 0;

    // Kontrollime, et number oleks valiidne ja piires (kui lehekülgede arv on teada)
    if (!isNaN(newPage) && newPage >= 1 && (totalPages === 0 || newPage <= totalPages)) {
      if (newPage !== currentPageNum) {
        if (hasUnsavedChanges) {
          setPendingNavigation(() => () => navigate(`/work/${workId}/${newPage}`, { replace: true }));
          setInputPage(currentPageNum.toString());
          return;
        }
        navigate(`/work/${workId}/${newPage}`, { replace: true });
      }
    } else {
      // Taasta praegune number, kui sisestus oli vigane
      setInputPage(currentPageNum.toString());
    }
  };

  useEffect(() => {
    if (!effectiveIndex) return;
    // Värske tab (nt Review-lingist, järjehoidjast, refreshist): auth initsialiseerub
    // async (initAuth → /verify-token + Meili-tokeni värskendus). Kuni see käib, oota —
    // muidu läheks restricted-teose päring anonüümse Meili-tokeniga → 403 → vale "logi
    // sisse" vilkumine. `loading` jääb true (spinner). Effect jookseb uuesti kui
    // authInitializing → false (dep-listis).
    if (authInitializing) return;
    const loadData = async () => {
      if (!workId) {
        setError("Töö ID on puudu.");
        setLoading(false);
        return;
      }
      // Spinner ainult teose vahetusel või esmalaadimisel. Sama teose sees lehte
      // vahetades jääb raam püsima — TextEditor sünkroniseerib sisu ise
      // (useEditorState `page`-effect), muidu monteeriks CodeMirror end iga
      // pöörde peal maha ja uuesti.
      const isWorkSwitch = loadedWorkIdRef.current !== workId;
      if (isWorkSwitch) setLoading(true);
      setPageLoading(true);
      setError(null);
      setErrorRequiresLogin(false);
      try {
        const pageData = await getPage(effectiveIndex, workId, currentPageNum);

        // Shareable fallback: teos on piiratud kollektsioonis aga võib olla jagatud.
        // Saadame ka Authorization päise — kui Meili indeks on (veel/taas) anonüümses
        // olekus (init-võidujooks või tokeni-värskenduse degradatsioon), siis getPage
        // tagastab piiratud teose puhul null. Auth päisega saab autenditud admin/editor
        // siiski teose-skoobiga tokeni ja leht laeb; ilma selleta tuli "Ligipääs keelatud".
        if (!pageData && !viewerToken) {
          const r = await fetch(`${FILE_API_URL}/work/${workId}/viewer-token`, {
            headers: authToken ? { Authorization: `Bearer ${authToken}` } : {},
          });
          if (r.ok) {
            const data = await r.json();
            setViewerToken(data.token);
            if (data.image_exp && data.image_sig) {
              setImageToken({ exp: data.image_exp, sig: data.image_sig });
            }
            return; // effectiveIndex uuendub → useEffect käivitub uuesti
          } else if (r.status === 403) {
            if (sessionExpired) {
              setError(t('errors.sessionExpiredProtectedWork'));
              setErrorRequiresLogin(true);
              setShowLoginModal(true);
            } else if (!user) {
              setError(t('errors.loginRequiredProtectedWork'));
              setErrorRequiresLogin(true);
            } else {
              setError(t('errors.accessDenied', { defaultValue: "Ligipääs keelatud." }));
            }
            setLoading(false);
            return;
          }
        }

        if (!pageData) {
          setError(t('errors.pageNotFound', { defaultValue: "Lehekülge ei leitud. Võimalik, et dokumendi lehekülgi on vahepeal ümber tõstetud või kustutatud. Proovi minna teose avalehele." }));
        } else {
          setPage(pageData);
          setCurrentStatus(pageData.status);
          loadedWorkIdRef.current = workId;
          // Redirect logic: If we asked for page 1, but got page 5 (because book starts there),
          // update the URL to reflect reality.
          if (pageData.page_number !== currentPageNum) {
            navigate(`/work/${workId}/${pageData.page_number}`, { replace: true });
          }
        }
      } catch (e: any) {
        console.error("Failed to load page", e);
        setError(e.message || "Viga andmete laadimisel. Palun kontrolli Meilisearchi ühendust.");
      } finally {
        setLoading(false);
        setPageLoading(false);
      }
    };
    loadData();
  }, [effectiveIndex, workId, currentPageNum, navigate, viewerToken, authToken, sessionExpired, user, authInitializing, t]);

  // Teose metaandmed — sõltuvad ainult teosest, mitte lehenumbrist. Eraldi
  // effect, et lehe vahetus samas teoses ei tooks kaasa uut Meili päringut ega
  // /get-work-metadata edasi-tagasi-käiku (#185). `effectiveIndex` on deps-listis,
  // sest piiratud teose puhul saab metaandmed kätte alles viewer-tokeniga.
  useEffect(() => {
    if (!effectiveIndex) return;
    if (authInitializing) return;
    if (!workId) return;
    let cancelled = false;

    // Teost vahetades ei tohi eelmise teose metaandmed hetkeks alles jääda —
    // lehe effect võib lõpetada enne seda ja renderdaks vale pealkirja/lehearvu.
    setWork(prev => (prev && prev.work_id !== workId ? undefined : prev));

    const loadWork = async () => {
      try {
        const workData = await getWorkMetadata(effectiveIndex, workId);
        if (cancelled || !workData) return;
        setWork(workData);

        // `shareable` on autoriteetne ainult failisüsteemist — Meili väärtus võib
        // olla vananenud. Endpoint nõuab editor-rolli, seega ülejäänutel jääb
        // kehtima Meili väärtus. Ei blokeeri lehe renderdust.
        if (!authToken) return;
        const metaResponse = await fetch(`${FILE_API_URL}/get-work-metadata`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${authToken}` },
          // original_path on endpointis ainult varuvariant (work_id on esmane) ja
          // pärineb samast Meili väljast mis lehe oma (originaal_kataloog).
          body: JSON.stringify({ work_id: workId, original_path: workData.catalog_name }),
        });
        const metaData = await metaResponse.json();
        if (cancelled) return;
        if (metaData.status === 'success' && metaData.metadata && typeof metaData.metadata.shareable === 'boolean') {
          const { shareable } = metaData.metadata;
          setWork(prev => (prev ? { ...prev, shareable } : prev));
        }
      } catch { /* Meili väärtus jääb fallbackiks */ }
    };

    loadWork();
    return () => { cancelled = true; };
  }, [effectiveIndex, workId, authToken, authInitializing]);

  // Metaandmete modaali avamine
  const openMetaModal = () => {
    if (page) setIsMetaModalOpen(true);
  };

  // Metaandmete salvestamise callback
  const handleMetadataSaved = (updatedPage: Partial<Page>, updatedWork: Partial<Work>) => {
    if (page) {
      setPage({ ...page, ...updatedPage });
    }
    if (work) {
      setWork({ ...work, ...updatedWork });
    }
  };

  const handleSave = async (updatedPage: Page) => {
    // Kontrolli, kas kasutaja on sisse logitud
    if (!user) {
      setSaveError(t('saveError.notLoggedIn'));
      return;
    }
    // Kontrolli autentimistõendit
    if (!authToken) {
      setSaveError(t('saveError.tokenMissing'));
      return;
    }


    // Toimetaja/admin muudatused salvestatakse otse
    const pageWithStatus = { ...updatedPage, status: currentStatus || updatedPage.status };
    try {
      const savedPage = await savePage(pageWithStatus, t('history.action.saved_changes'), user.name, authToken);
      setPage(savedPage);
      setCurrentStatus(savedPage.status);
      setEditorChanges(false);
    } catch (e: any) {
      if (e.message === 'AUTH_EXPIRED' || e.status === 401) {
        // Token aegunud salvestamise ajal — ava LoginModal
        logout();
        setShowLoginModal(true);
      }
    }
  };

  const appendImageToken = useCallback((url: string): string => {
    if (!imageToken) return url;
    const sep = url.includes('?') ? '&' : '?';
    return `${url}${sep}exp=${imageToken.exp}&sig=${imageToken.sig}`;
  }, [imageToken]);

  const currentImageSrc = useMemo(() => {
    if (!page?.image_url) return '';
    try {
      const replaced = JSON.parse(sessionStorage.getItem('vutt_replaced_images') || '{}');
      const key = `${workId}/${page.page_number}`;
      if (replaced[key]) {
        return appendImageToken(`${page.image_url}?v=${replaced[key]}`);
      }
    } catch { /* ignore */ }
    return appendImageToken(page.image_url);
  }, [appendImageToken, page?.image_url, page?.page_number, workId]);

  const handleOpenGridView = useCallback(async () => {
    if (!work || !effectiveIndex) return;
    setIsGridView(true);
    setGridLoading(true);
    const pages = await getWorkPageImages(effectiveIndex, work.work_id, work.page_count);
    setGridPages(imageToken ? pages.map(p => ({ ...p, imageUrl: appendImageToken(p.imageUrl) })) : pages);
    setGridLoading(false);
  }, [work, effectiveIndex, imageToken, appendImageToken]);

  const handleSelectFromGrid = useCallback((pageNum: number) => {
    setIsGridView(false);
    if (hasUnsavedChanges) {
      setPendingNavigation(() => () => navigate(`/work/${workId}/${pageNum}`, { replace: true }));
      return;
    }
    navigate(`/work/${workId}/${pageNum}`, { replace: true });
  }, [hasUnsavedChanges, navigate, workId]);

  const navigatePage = useCallback((delta: number) => {
    if (!workId) return;

    const newPage = currentPageNum + delta;

    // Validate bounds
    if (newPage < 1) return;
    if (work?.page_count && newPage > work.page_count) return;

    // Hoiatus salvestamata muudatuste korral
    if (hasUnsavedChanges) {
      setPendingNavigation(() => () => navigate(`/work/${workId}/${newPage}`, { replace: true }));
      return;
    }

    // ?q= jäetakse URL-ist välja — eesmärk: otsisõna paneel avaneb ainult esimesel lehel, mitte iga lehevahetusel
    navigate(`/work/${workId}/${newPage}`, { replace: true });
  }, [workId, currentPageNum, work?.page_count, hasUnsavedChanges, navigate]);

  if (loading) {
    return (
      <div className="h-screen w-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-600 mx-auto mb-4"></div>
          <p className="text-gray-500 font-medium">{t('common:labels.loading')}</p>
        </div>
      </div>
    );
  }

  // Login modaal jagatud nii vea- kui tavavaate vahel. Vearee varajane return
  // (allpool) jättis modaali muidu monteerimata → "logi sisse" nupp ei avanud
  // midagi (väljalogitud kasutaja piiratud teosel).
  const loginModal = (
    <LoginModal
      isOpen={showLoginModal}
      onClose={() => {
        setShowLoginModal(false);
        clearSessionExpired();
      }}
      message={sessionExpired ? t('errors.sessionExpiredProtectedWork') : undefined}
    />
  );

  if (error || !page) {
    return (
      <>
      <div className="h-screen w-screen flex items-center justify-center bg-gray-50">
        <div className="text-center max-w-md p-8 bg-white rounded-lg shadow-sm border border-gray-200">
          <div className={`mb-4 flex justify-center ${errorRequiresLogin ? 'text-primary-500' : 'text-red-500'}`}>
            {errorRequiresLogin ? <LogIn size={48} /> : <AlertTriangle size={48} />}
          </div>
          <h2 className="text-xl font-bold text-gray-800 mb-2">
            {errorRequiresLogin ? t('common:errors.loginRequiredTitle') : t('common:errors.unknownError')}
          </h2>
          <p className="text-gray-600 mb-6">{error || t('common:errors.unknownError')}</p>
          <div className="text-xs bg-gray-100 p-2 rounded mb-4 text-left font-mono overflow-auto max-h-32">
            Debug: WorkID: {workId}, Page: {currentPageNum}
          </div>
          <div className="flex gap-3 justify-center">
            {errorRequiresLogin ? (
              <button
                onClick={() => setShowLoginModal(true)}
                className="inline-flex items-center gap-2 px-4 py-2 bg-primary-600 text-white rounded hover:bg-primary-700 transition-colors"
              >
                <LogIn size={16} />
                {t('auth:login.title')}
              </button>
            ) : (
              <button
                onClick={() => navigate(`/work/${workId}/1`, { replace: true })}
                className="px-4 py-2 bg-primary-600 text-white rounded hover:bg-primary-700 transition-colors"
              >
                {t('workspace:navigation.toFirstPage', 'Mine teose algusesse')}
              </button>
            )}
            <button
              onClick={() => navigate('/')}
              className="px-4 py-2 bg-gray-200 text-gray-700 rounded hover:bg-gray-300 transition-colors"
            >
              {t('navigation.backToDashboard')}
            </button>
          </div>
        </div>
      </div>
      {loginModal}
      </>
    );
  }

  // Navigeerimine tagasi dashboardile või otsingusse (salvestatud URL-i järgi)
  const getReturnUrl = () => sessionStorage.getItem('vutt_return_url') || '/';
  const handleNavigateBack = () => {
    const returnUrl = getReturnUrl();
    if (hasUnsavedChanges) {
      setPendingNavigation(() => () => navigate(returnUrl));
      return;
    }
    navigate(returnUrl);
  };

  // Navigeerimine otsingusse (selle teose piires)
  const handleNavigateToSearch = () => {
    const workCollections = work?.collections_hierarchy ?? work?.collections ?? [];
    const workCollection = workCollections[0] ?? null;
    // Ära kirjuta üle, kui praegune valik on juba teose hierarhias (nt virtuaalkollektsioon)
    if (workCollection && !workCollections.includes(selectedCollection ?? '')) {
      setSelectedCollection(workCollection);
    }
    if (hasUnsavedChanges) {
      setPendingNavigation(() => () => navigate(`/search?work=${workId}`));
      return;
    }
    navigate(`/search?work=${workId}`);
  };

  // Kinnitusdialoogi käsitlejad
  const handleConfirmLeave = () => {
    if (isBlocked) {
      proceed();
    } else if (pendingNavigation) {
      pendingNavigation();
      setPendingNavigation(null);
    }
  };

  const handleSaveAndLeave = async () => {
    const pendingLoc = blockedLocation;
    const navCallback = pendingNavigation;

    if (isBlocked) reset();
    setPendingNavigation(null);

    if (editorSaveRef.current) {
      try { await editorSaveRef.current(); } catch { /* alert on juba TextEditoris */ }
    }

    // Blocker bypass: navigeerimisel ei pea hasUnsavedChanges kontrollima
    skipBlockerRef.current = true;
    if (pendingLoc) {
      navigate(pendingLoc.pathname + pendingLoc.search + pendingLoc.hash);
    } else if (navCallback) {
      navCallback();
    }
    requestAnimationFrame(() => { skipBlockerRef.current = false; });
  };

  const showLeaveConfirm = isBlockerActive || pendingNavigation !== null;

  // COinS (ContextObjects in Spans) Zotero jaoks
  const generateCoins = () => {
    if (!page) return null;

    const title = work?.title || page.title || '';

    // Leia autor ja respondens creators massiivist
    let author = page.autor || '';
    let respondens = page.respondens || '';

    if (work?.creators && work.creators.length > 0) {
      const authorCreator = work.creators.find(c => c.role === 'praeses' || c.role === 'auctor');
      if (authorCreator) author = authorCreator.name;

      const respondensCreator = work.creators.find(c => c.role === 'respondens');
      if (respondensCreator) respondens = respondensCreator.name;
    }

    const year = work?.year ?? page.year ?? 0;
    const place = getLabel(work?.location || page.location || '');
    const printer = getLabel(work?.publisher || page.publisher || '');
    const languages = work?.languages || page.languages || [];

    const params = new URLSearchParams();
    params.set('ctx_ver', 'Z39.88-2004');
    params.set('rft_val_fmt', 'info:ofi/fmt:kev:mtx:book');
    params.set('rft.genre', 'book');
    if (title) params.set('rft.btitle', title);
    if (author) params.set('rft.au', author);
    if (respondens) params.set('rft.contributor', respondens); // Respondens kui kaastööline
    if (year) params.set('rft.date', year.toString());
    if (place) params.set('rft.place', place);
    if (printer) params.set('rft.pub', printer);
    if (languages.length > 0) params.set('rft.language', languages.join(', '));
    const extUrl = work?.external_url || page.external_url;
    if (extUrl && /^https?:\/\//.test(extUrl)) params.set('rft_id', extUrl);

    return params.toString();
  };

  return (
    <div className="workspace-container h-screen flex flex-col bg-gray-100 overflow-hidden">
      {/* COinS for Zotero - peidetud span bibliograafiliste andmetega */}
      {page && <span className="Z3988" title={generateCoins() || ''} />}

      {/* Lehe vahetus samas teoses ei võta editorit maha (vt loadData) — õhuke
          riba annab tagasiside, ilma et raam vahepeal kaoks. */}
      {pageLoading && (
        <div
          className="fixed top-0 left-0 right-0 h-0.5 bg-primary-500/70 animate-pulse z-[60]"
          role="status"
          aria-label={t('common:labels.loading')}
        />
      )}

      {/* Top Navigation Bar (desktop only) */}
      <div className="hidden md:flex h-12 bg-white border-b border-gray-200 items-center justify-between px-4 shrink-0 shadow-sm relative z-50">
        <div className="flex items-center gap-2">
          {/* Avaleht */}
          <button
            onClick={handleNavigateBack}
            className="p-1.5 hover:bg-gray-100 rounded-md text-gray-600 transition-colors flex items-center gap-1.5"
            title={t('navigation.backToDashboard')}
          >
            <img src="/logo.png" alt="VUTT" className="h-5 w-auto" />
            <span className="font-bold text-gray-800 tracking-tight hidden sm:inline">{t('common:app.name')}</span>
          </button>
          {/* Otsing */}
          <button
            onClick={handleNavigateToSearch}
            className="p-1.5 hover:bg-primary-50 rounded-md text-primary-600 transition-colors flex items-center gap-1.5 text-sm"
            title={t('common:buttons.search')}
          >
            <Search size={16} />
            <span className="hidden sm:inline">{t('common:buttons.search')}</span>
          </button>
          <div className="h-6 w-px bg-gray-300"></div>
          <div className="flex items-center gap-1 text-sm">
            <span className="text-gray-500">ID:</span>
            <button
              onClick={handleCopyPermalink}
              className="group flex items-center gap-1.5 font-mono text-gray-700 bg-gray-100 hover:bg-gray-200 px-1.5 py-0.5 rounded text-xs transition-colors"
              title={t('workspace:navigation.copyPermalink', 'Kopeeri permalink (vutt:ID)')}
            >
              {workId}
              {copied ? (
                <Check size={12} className="text-green-600" />
              ) : (
                <Copy size={12} className="text-gray-400 group-hover:text-gray-600" />
              )}
            </button>
          </div>
        </div>

        {/* Pagination Controls */}
        <div className="flex items-center gap-2">
          <button
            onClick={() => navigatePage(-1)}
            disabled={currentPageNum <= 1}
            className="p-1.5 hover:bg-gray-100 rounded text-gray-600 disabled:opacity-30 transition-all"
          >
            <ChevronLeft size={20} />
          </button>
          <div className="flex items-center gap-1.5 mx-1">
            <span className="text-sm font-medium text-gray-600">{t('navigation.page')}</span>
            <input
              className="w-12 text-center text-sm font-medium border border-gray-300 rounded px-1 py-0.5 focus:ring-2 focus:ring-primary-500 outline-none text-gray-700"
              value={inputPage}
              onChange={(e) => setInputPage(e.target.value)}
              onBlur={handlePageInputSubmit}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  handlePageInputSubmit();
                  e.currentTarget.blur();
                }
              }}
            />
            {work?.page_count && (
              <span className="text-sm font-medium text-gray-500 select-none">
                / {work.page_count}
              </span>
            )}
          </div>
          <button
            onClick={() => navigatePage(1)}
            disabled={work?.page_count ? currentPageNum >= work.page_count : false}
            className="p-1.5 hover:bg-gray-100 rounded text-gray-600 disabled:opacity-30 transition-all"
          >
            <ChevronRight size={20} />
          </button>
        </div>

        <div className="flex items-center gap-2">
          {/* Kasutaja menüü */}
          {user ? (
            <UserMenu />
          ) : (
            <button
              onClick={() => setShowLoginModal(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-primary-600 text-white rounded-md hover:bg-primary-700 font-medium text-sm transition-colors"
            >
              <LogIn size={16} />
              {t('auth:login.title')}
            </button>
          )}
          <LanguageSwitcher />
        </div>
      </div>

      {saveError && (
        <div className="px-4 py-2 shrink-0 z-40">
          <ErrorBanner message={saveError} onClose={() => setSaveError(null)} />
        </div>
      )}

      {/* Split View Content (desktop only) */}
      <div className="hidden md:flex flex-1 flex-row overflow-hidden relative z-0">
        {/* Left: Image Viewer */}
        <div className="w-full h-1/2 md:w-1/2 md:h-full border-b md:border-b-0 md:border-r border-gray-300 relative bg-slate-900">
          {/* Lisame errori käsitluse pildile, juhuks kui pildiserver ei tööta */}
          {page.image_url ? (
            <ImageViewer
              src={currentImageSrc}
              pageNum={page.page_number}
              onGridView={handleOpenGridView}
              onNavigate={(dir) => navigatePage(dir === 'next' ? 1 : -1)}
              isAdmin={isAdmin}
              onManage={() => navigate(buildManageLink(workId!, page.page_number))}
            />
          ) : (
            <div className="flex items-center justify-center h-full text-white/50">
              Pilt puudub
            </div>
          )}
        </div>

        {/* Thumbnail grid overlay */}
        {isGridView && (
          <ThumbnailGrid
            pages={gridPages}
            currentPage={currentPageNum}
            loading={gridLoading}
            onSelectPage={handleSelectFromGrid}
            onClose={() => setIsGridView(false)}
            work={work}
            cols={gridCols}
            onColsChange={setGridCols}
          />
        )}

        {/* Right: Text Editor */}
        <div className="w-full h-1/2 md:w-1/2 md:h-full bg-white relative flex flex-col">
          <div className="flex-1 min-h-0">
          <TextEditor
            page={page}
            work={work}
            onSave={handleSave}
            onUnsavedChanges={setEditorChanges}
            onOpenMetaModal={isAtLeast(user?.role, 'admin') ? openMetaModal : undefined}
            readOnly={!user}
            statusDirty={statusDirty}
            currentStatus={currentStatus}
            onStatusChange={user ? setCurrentStatus : undefined}
            triggerSave={editorSaveRef}
            onWorkUpdate={(updatedWork) => setWork(prev => prev ? { ...prev, ...updatedWork } : prev)}
            collections={collections}
          />
          </div>
        </div>
      </div>

      {/* Mobiil: tab-põhine read-only vaade */}
      <div className="md:hidden flex-1 overflow-hidden">
        <WorkspaceMobileView
          page={page}
          imageSrc={currentImageSrc}
          work={work}
          workId={workId!}
          currentPageNum={currentPageNum}
          onNavigatePage={navigatePage}
          onNavigateBack={handleNavigateBack}
          inputPage={inputPage}
          onInputPageChange={setInputPage}
          onPageInputSubmit={handlePageInputSubmit}
          gridPages={gridPages}
          gridLoading={gridLoading}
          onOpenGrid={handleOpenGridView}
          onSelectPage={handleSelectFromGrid}
        />
      </div>

      {/* Metaandmete muutmise modal */}
      {page && workId && authToken && (
        <MetadataModal
          isOpen={isMetaModalOpen}
          onClose={() => setIsMetaModalOpen(false)}
          page={page}
          work={work}
          workId={workId}
          authToken={authToken}
          userRole={user?.role || 'contributor'}
          collections={collections}
          onSaveSuccess={handleMetadataSaved}
        />
      )}

      {/* Salvestamata muudatuste kinnitusdialoog */}
      <ConfirmModal
        isOpen={showLeaveConfirm}
        title={t('editor.unsavedChanges')}
        message={t('confirm.unsavedChangesPrompt')}
        confirmText={t('confirm.saveAndLeave')}
        cancelText={t('confirm.leaveWithoutSaving')}
        onConfirm={handleSaveAndLeave}
        onCancel={handleConfirmLeave}
        variant="warning"
      />

      {/* Login modaal (sessioon aegunud või käsitsi avatud) */}
      {loginModal}
    </div>
  );
};

export default Workspace;