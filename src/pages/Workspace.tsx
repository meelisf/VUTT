import React, { useEffect, useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams, useNavigate, Link, useBlocker } from 'react-router-dom';
import { getPage, savePage, getWorkMetadata, checkPendingEdits, savePageAsPending, PendingEditInfo } from '../services/meiliService';
import type { Page, Work } from '../types';
import { PageStatus } from '../types';
import ImageViewer from '../components/ImageViewer';
import TextEditor from '../components/TextEditor';
import ConfirmModal from '../components/ConfirmModal';
import LanguageSwitcher from '../components/LanguageSwitcher';
import { useUser } from '../contexts/UserContext';
import { useCollection } from '../contexts/CollectionContext';
import MetadataModal from '../components/MetadataModal';
import { ChevronLeft, ChevronRight, AlertTriangle, Search, Home, LogOut, Settings, History } from 'lucide-react';
import { FILE_API_URL } from '../config';
import { getLabel } from '../utils/metadataUtils';

const Workspace: React.FC = () => {
  const { t, i18n } = useTranslation(['workspace', 'common']);
  const { user, authToken, logout } = useUser();
  const { collections } = useCollection();
  const lang = (i18n.language as 'et' | 'en') || 'et';
  const { workId, pageNum } = useParams<{ workId: string, pageNum: string }>();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState<Page | null>(null);
  const [work, setWork] = useState<Work | undefined>(undefined);
  const [editorChanges, setEditorChanges] = useState(false);
  const [currentStatus, setCurrentStatus] = useState<PageStatus | null>(null);
  const statusDirty = page && currentStatus ? currentStatus !== page.status : false;
  const hasUnsavedChanges = editorChanges || statusDirty;

  // Sünkroniseeri olekud kui leht vahetub
  useEffect(() => {
    setEditorChanges(false);
  }, [pageNum]);

  // Metaandmete muutmise modal
  const [isMetaModalOpen, setIsMetaModalOpen] = useState(false);

  // Pending-edit olek (kaastöölistele)
  // MÄRKUS: Contributor/pending-edit süsteem on implementeeritud, kuid EI OLE KASUTUSEL.
  // Uued kasutajad saavad editor rolli, seega isContributor on alati false.
  // Vt server/pending_edits.py ja server/registration.py kommentaare.
  const [pendingEditInfo, setPendingEditInfo] = useState<PendingEditInfo | null>(null);
  const [originalTextForPending, setOriginalTextForPending] = useState<string>('');
  const isContributor = user?.role === 'contributor';

  // Salvestamata muudatuste kinnitusdialoogi olek
  const [pendingNavigation, setPendingNavigation] = useState<(() => void) | null>(null);

  // Kasutaja menüü olek
  const [showUserMenu, setShowUserMenu] = useState(false);

  const currentPageNum = parseInt(pageNum || '1', 10);

  // Lehekülje numbri sisestamise olek
  const [inputPage, setInputPage] = useState(pageNum || '1');

  // Sünkroniseeri sisendväli URL-i muutustega (nt nuppudega navigeerimisel)
  useEffect(() => {
    setInputPage(pageNum || '1');
  }, [pageNum]);

  // Browser level prevent-unload (refresh, close, external links)
  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (hasUnsavedChanges) {
        e.preventDefault();
        e.returnValue = ''; // Trigger browser prompt
      }
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [hasUnsavedChanges]);

  // React Router level blocker (internal navigation, back button)
  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) =>
      hasUnsavedChanges && currentLocation.pathname !== nextLocation.pathname
  );

  // Kontrolli kas blocker on aktiivne (kasutatakse modaali kuvamiseks)
  const isBlockerActive = blocker.state === "blocked";

  const handlePageInputSubmit = () => {
    if (!workId) return;
    const newPage = parseInt(inputPage, 10);
    const totalPages = work?.page_count || 0;

    // Kontrollime, et number oleks valiidne ja piires (kui lehekülgede arv on teada)
    if (!isNaN(newPage) && newPage >= 1 && (totalPages === 0 || newPage <= totalPages)) {
      if (newPage !== currentPageNum) {
        navigate(`/work/${workId}/${newPage}`);
      }
    } else {
      // Taasta praegune number, kui sisestus oli vigane
      setInputPage(currentPageNum.toString());
    }
  };

  useEffect(() => {
    const loadData = async () => {
      if (!workId) {
        setError("Töö ID on puudu.");
        setLoading(false);
        return;
      }
      setLoading(true);
      setError(null);
      try {
        const [pageData, workData] = await Promise.all([
          getPage(workId, currentPageNum),
          getWorkMetadata(workId)
        ]);

        if (!pageData) {
          setError("Lehekülge ei leitud. Võimalik, et dokumendi lehekülgi on vahepeal ümber tõstetud või kustutatud. Proovi minna teose avalehele.");
        } else {
          setPage(pageData);
          setCurrentStatus(pageData.status);
          if (workData) setWork(workData);
          // Redirect logic: If we asked for page 1, but got page 5 (because book starts there),
          // update the URL to reflect reality.
          if (pageData.page_number !== currentPageNum) {
            console.log(`Redirecting from requested page ${currentPageNum} to found page ${pageData.page_number}`);
            navigate(`/work/${workId}/${pageData.page_number}`, { replace: true });
          }
        }
      } catch (e: any) {
        console.error("Failed to load page", e);
        setError(e.message || "Viga andmete laadimisel. Palun kontrolli Meilisearchi ühendust.");
      } finally {
        setLoading(false);
      }
    };
    loadData();
  }, [workId, currentPageNum, navigate]);

  // Kontrolli pending-edit staatust ja salvesta originaaltekst kaastöölise jaoks
  useEffect(() => {
    const checkPending = async () => {
      if (!page || !authToken || !workId) return;

      // Salvesta originaaltekst, et saaksime pending-edit loomisel kasutada
      if (isContributor) {
        setOriginalTextForPending(page.text_content || '');
      }

      // Kontrolli pending-staatust
      try {
        const info = await checkPendingEdits(workId, currentPageNum, authToken);
        setPendingEditInfo(info);
      } catch (e) {
        console.error('Pending check error:', e);
      }
    };

    checkPending();
  }, [page, authToken, workId, currentPageNum, isContributor]);

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
      alert('Salvestamiseks pead olema sisse logitud.');
      return;
    }
    // Kontrolli autentimistõendit
    if (!authToken) {
      alert('Salvestamiseks pead olema sisse logitud. Palun logi välja ja uuesti sisse.');
      return;
    }

    // Kaastöölise muudatused lähevad pending-olekusse
    if (isContributor && workId) {
      const result = await savePageAsPending(
        workId,
        currentPageNum,
        originalTextForPending,
        updatedPage.text_content || '',
        authToken
      );

      if (result.success) {
        // Uuenda pending info
        const info = await checkPendingEdits(workId, currentPageNum, authToken);
        setPendingEditInfo(info);
        setEditorChanges(false);

        // Näita teadet
        if (result.hasOtherPending) {
          alert(t('workspace:pendingEdit.savedWithConflict') || 'Muudatus salvestatud ülevaatusele. NB: Teine kasutaja on samale lehele juba muudatuse esitanud.');
        } else {
          alert(t('workspace:pendingEdit.saved') || 'Muudatus salvestatud ülevaatusele. Toimetaja vaatab selle üle.');
        }
      } else {
        alert(result.error || 'Salvestamine ebaõnnestus');
      }
      return;
    }

    // Toimetaja/admin muudatused salvestatakse otse
    const pageWithStatus = { ...updatedPage, status: currentStatus || updatedPage.status };
    const savedPage = await savePage(pageWithStatus, t('history.action.saved_changes'), user.name, { token: authToken });
    setPage(savedPage);
    setCurrentStatus(savedPage.status);
    setEditorChanges(false);
  };

  const navigatePage = useCallback((delta: number) => {
    if (!workId) return;

    const newPage = currentPageNum + delta;

    // Validate bounds
    if (newPage < 1) return;
    if (work?.page_count && newPage > work.page_count) return;

    // Hoiatus salvestamata muudatuste korral
    if (hasUnsavedChanges) {
      setPendingNavigation(() => () => navigate(`/work/${workId}/${newPage}`));
      return;
    }

    navigate(`/work/${workId}/${newPage}`);
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

  if (error || !page) {
    return (
      <div className="h-screen w-screen flex items-center justify-center bg-gray-50">
        <div className="text-center max-w-md p-8 bg-white rounded-lg shadow-sm border border-gray-200">
          <div className="text-red-500 mb-4 flex justify-center"><AlertTriangle size={48} /></div>
          <h2 className="text-xl font-bold text-gray-800 mb-2">{t('common:errors.unknownError')}</h2>
          <p className="text-gray-600 mb-6">{error || t('common:errors.unknownError')}</p>
          <div className="text-xs bg-gray-100 p-2 rounded mb-4 text-left font-mono overflow-auto max-h-32">
            Debug: WorkID: {workId}, Page: {currentPageNum}
          </div>
          <div className="flex gap-3 justify-center">
            <button
              onClick={() => navigate(`/work/${workId}/1`)}
              className="px-4 py-2 bg-primary-600 text-white rounded hover:bg-primary-700 transition-colors"
            >
              {t('workspace:navigation.toFirstPage', 'Mine teose algusesse')}
            </button>
            <button
              onClick={() => navigate('/')}
              className="px-4 py-2 bg-gray-200 text-gray-700 rounded hover:bg-gray-300 transition-colors"
            >
              {t('navigation.backToDashboard')}
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Navigeerimine tagasi dashboardile
  const handleNavigateBack = () => {
    if (hasUnsavedChanges) {
      setPendingNavigation(() => () => navigate('/'));
      return;
    }
    navigate('/');
  };

  // Navigeerimine otsingusse (selle teose piires)
  const handleNavigateToSearch = () => {
    if (hasUnsavedChanges) {
      setPendingNavigation(() => () => navigate(`/search?work=${workId}`));
      return;
    }
    navigate(`/search?work=${workId}`);
  };

  // Kinnitusdialoogi käsitlejad
  const handleConfirmLeave = () => {
    if (isBlockerActive) {
      blocker.proceed();
    } else if (pendingNavigation) {
      pendingNavigation();
      setPendingNavigation(null);
    }
  };

  const handleCancelLeave = () => {
    if (isBlockerActive) {
      blocker.reset();
    } else {
      setPendingNavigation(null);
    }
  };

  const showLeaveConfirm = isBlockerActive || pendingNavigation !== null;

  // COinS (ContextObjects in Spans) Zotero jaoks
  const generateCoins = () => {
    if (!page) return null;

    const title = work?.title || page.pealkiri || '';
    const author = work?.author || page.autor || '';
    const respondens = work?.respondens || page.respondens || '';
    const year = work?.year || page.aasta || 0;
    const place = getLabel(work?.location || page.location || page.koht || (year >= 1699 ? 'Pärnu' : 'Tartu'));
    const printer = getLabel(work?.publisher || page.publisher || page.trükkal || 'Typis Academicis');

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

    return params.toString();
  };

  return (
    <div className="workspace-container h-screen flex flex-col bg-gray-100 overflow-hidden">
      {/* COinS for Zotero - peidetud span bibliograafiliste andmetega */}
      {page && <span className="Z3988" title={generateCoins() || ''} />}

      {/* Top Navigation Bar */}
      <div className="h-12 bg-white border-b border-gray-200 flex items-center justify-between px-4 shrink-0 shadow-sm relative z-50">
        <div className="flex items-center gap-2">
          {/* Avaleht */}
          <button
            onClick={handleNavigateBack}
            className="p-1.5 hover:bg-gray-100 rounded-md text-gray-600 transition-colors flex items-center gap-1.5"
            title={t('navigation.backToDashboard')}
          >
            <Home size={16} />
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
            <span className="font-mono text-gray-700 bg-gray-100 px-1.5 py-0.5 rounded text-xs">
              {workId}
            </span>
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
            <div className="relative">
              <button
                onClick={() => setShowUserMenu(!showUserMenu)}
                className="flex items-center justify-center h-8 w-8 bg-primary-100 rounded-full text-primary-700 font-bold text-xs hover:bg-primary-200 transition-colors"
                title={user.name}
              >
                {user.name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase()}
              </button>

              {showUserMenu && (
                <>
                  <div className="fixed inset-0 z-[100]" onClick={() => setShowUserMenu(false)} />
                  <div className="absolute right-0 top-full mt-1 bg-white rounded-lg shadow-lg border border-gray-200 py-1 min-w-48 z-[110]">
                    <div className="px-4 py-2 border-b border-gray-100">
                      <p className="text-sm font-medium text-gray-900">{user.name}</p>
                      <p className="text-xs text-gray-500">{t(`common:roles.${user.role}`)}</p>
                    </div>
                    <Link
                      to="/review"
                      onClick={() => setShowUserMenu(false)}
                      className="flex items-center gap-2 px-4 py-2 text-sm text-gray-700 hover:bg-gray-100"
                    >
                      <History size={16} />
                      {t('common:nav.review')}
                    </Link>
                    {user.role === 'admin' && (
                      <Link
                        to="/admin"
                        onClick={() => setShowUserMenu(false)}
                        className="flex items-center gap-2 px-4 py-2 text-sm text-gray-700 hover:bg-gray-100"
                      >
                        <Settings size={16} />
                        {t('common:nav.admin')}
                      </Link>
                    )}
                    <div className="border-t border-gray-100 my-1" />
                    <button
                      onClick={() => { setShowUserMenu(false); logout(); }}
                      className="flex items-center gap-2 px-4 py-2 text-sm text-red-600 hover:bg-red-50 w-full"
                    >
                      <LogOut size={16} />
                      {t('common:buttons.logout')}
                    </button>
                  </div>
                </>
              )}
            </div>
          ) : null}
          <LanguageSwitcher />
        </div>
      </div>

      {/* Split View Content */}
      <div className="flex-1 flex overflow-hidden relative z-0">
        {/* Left: Image Viewer */}
        <div className="w-1/2 h-full border-r border-gray-300 relative bg-slate-900">
          {/* Lisame errori käsitluse pildile, juhuks kui pildiserver ei tööta */}
          {page.image_url ? (
            <ImageViewer src={page.image_url} />
          ) : (
            <div className="flex items-center justify-center h-full text-white/50">
              Pilt puudub
            </div>
          )}
        </div>

        {/* Right: Text Editor */}
        <div className="w-1/2 h-full bg-white relative flex flex-col">
          {/* Pending-edit staatuse banner */}
          {pendingEditInfo?.has_own_pending && (
            <div className="bg-amber-50 border-b border-amber-200 px-4 py-2 flex items-center gap-2 text-sm text-amber-800">
              <AlertTriangle size={16} className="text-amber-600 flex-shrink-0" />
              <span>
                {t('workspace:pendingEdit.hasPending') || 'Sul on selle lehe kohta muudatus ülevaatusel.'}
                {pendingEditInfo.own_pending_edit && (
                  <span className="text-amber-600 ml-1">
                    ({new Date(pendingEditInfo.own_pending_edit.submitted_at).toLocaleDateString('et-EE')})
                  </span>
                )}
              </span>
            </div>
          )}
          {pendingEditInfo && pendingEditInfo.other_pending_count > 0 && (
            <div className="bg-blue-50 border-b border-blue-200 px-4 py-2 flex items-center gap-2 text-sm text-blue-800">
              <AlertTriangle size={16} className="text-blue-600 flex-shrink-0" />
              <span>
                {t('workspace:pendingEdit.otherPending', { count: pendingEditInfo.other_pending_count }) ||
                  `Sellel lehel on ${pendingEditInfo.other_pending_count} ootel muudatus(t) teistelt kasutajatelt.`}
              </span>
            </div>
          )}
          <div className="flex-1 overflow-hidden">
          <TextEditor
            page={page}
            work={work}
            onSave={handleSave}
            onUnsavedChanges={setEditorChanges}
            onOpenMetaModal={user?.role === 'admin' ? openMetaModal : undefined}
            readOnly={!user}
            statusDirty={statusDirty}
            currentStatus={currentStatus}
            onStatusChange={user && !isContributor ? setCurrentStatus : undefined}
          />
          </div>
        </div>
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
          collections={collections}
          onSaveSuccess={handleMetadataSaved}
        />
      )}

      {/* Salvestamata muudatuste kinnitusdialoog */}
      <ConfirmModal
        isOpen={showLeaveConfirm}
        title={t('editor.unsavedChanges')}
        message={t('confirm.unsavedChanges')}
        onConfirm={handleConfirmLeave}
        onCancel={handleCancelLeave}
        variant="warning"
      />
    </div>
  );
};

export default Workspace;