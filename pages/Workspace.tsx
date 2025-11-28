
import React, { useEffect, useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { getPage, savePage, getWorkMetadata } from '../services/meiliService';
import { Page, PageStatus, Work } from '../types';
import ImageViewer from '../components/ImageViewer';
import TextEditor from '../components/TextEditor';
import { useUser } from '../contexts/UserContext';
import { ArrowLeft, ChevronLeft, ChevronRight, AlertTriangle } from 'lucide-react';

const Workspace: React.FC = () => {
  const { user } = useUser();
  const { workId, pageNum } = useParams<{ workId: string, pageNum: string }>();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState<Page | null>(null);
  const [work, setWork] = useState<Work | undefined>(undefined);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);

  const currentPageNum = parseInt(pageNum || '1', 10);

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
          setError("Lehekülge ei leitud. Kontrolli, kas Meilisearchis on andmed olemas.");
        } else {
          setPage(pageData);
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

  const handleSave = async (updatedPage: Page) => {
    // Kontrolli, kas kasutaja on sisse logitud
    if (!user) {
      alert('Salvestamiseks pead olema sisse logitud.');
      return;
    }
    // Salvestame ja saame tagasi uuendatud lehe (koos uue ajalooga)
    const savedPage = await savePage(updatedPage, 'Salvestas muudatused', user.name);
    setPage(savedPage);
  };

  const navigatePage = (delta: number) => {
    if (!workId) return;

    const newPage = currentPageNum + delta;

    // Validate bounds
    if (newPage < 1) return;
    if (work?.page_count && newPage > work.page_count) return;
    
    // Hoiatus salvestamata muudatuste korral
    if (hasUnsavedChanges) {
      const confirmed = window.confirm('Sul on salvestamata muudatused. Kas soovid kindlasti lahkuda?');
      if (!confirmed) return;
    }

    navigate(`/work/${workId}/${newPage}`);
  };

  if (loading) {
    return (
      <div className="h-screen w-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-600 mx-auto mb-4"></div>
          <p className="text-gray-500 font-medium">Laen töölauda Meilisearchist...</p>
        </div>
      </div>
    );
  }

  if (error || !page) {
    return (
      <div className="h-screen w-screen flex items-center justify-center bg-gray-50">
        <div className="text-center max-w-md p-8 bg-white rounded-lg shadow-sm border border-gray-200">
          <div className="text-red-500 mb-4 flex justify-center"><AlertTriangle size={48} /></div>
          <h2 className="text-xl font-bold text-gray-800 mb-2">Midagi läks valesti</h2>
          <p className="text-gray-600 mb-6">{error || "Tundmatu viga."}</p>
          <div className="text-xs bg-gray-100 p-2 rounded mb-4 text-left font-mono overflow-auto max-h-32">
            Debug: WorkID: {workId}, Page: {currentPageNum}
          </div>
          <button
            onClick={() => navigate('/')}
            className="px-4 py-2 bg-primary-600 text-white rounded hover:bg-primary-700 transition-colors"
          >
            Tagasi avalehele
          </button>
        </div>
      </div>
    );
  }

  // Navigeerimine tagasi koos hoiatusega
  const handleNavigateBack = () => {
    if (hasUnsavedChanges) {
      const confirmed = window.confirm('Sul on salvestamata muudatused. Kas soovid kindlasti lahkuda?');
      if (!confirmed) return;
    }
    navigate(-1);
  };

  return (
    <div className="h-screen flex flex-col bg-gray-100 overflow-hidden">
      {/* Top Navigation Bar */}
      <div className="h-12 bg-white border-b border-gray-200 flex items-center justify-between px-4 shrink-0 shadow-sm z-10">
        <div className="flex items-center gap-4">
          <button
            onClick={handleNavigateBack}
            className="p-1.5 hover:bg-gray-100 rounded-md text-gray-600 transition-colors flex items-center gap-2"
            title="Tagasi"
          >
            <ArrowLeft size={18} />
            <span className="font-bold text-gray-800 tracking-tight">VUTT</span>
          </button>
          <div className="h-6 w-px bg-gray-300"></div>
          <div className="flex items-center gap-2 text-sm">
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
          <span className="text-sm font-medium w-32 text-center text-gray-700 select-none">
            Lk {page.page_number} {work?.page_count ? `/ ${work.page_count}` : ''}
          </span>
          <button
            onClick={() => navigatePage(1)}
            disabled={work?.page_count ? currentPageNum >= work.page_count : false}
            className="p-1.5 hover:bg-gray-100 rounded text-gray-600 disabled:opacity-30 transition-all"
          >
            <ChevronRight size={20} />
          </button>
        </div>

        <div className="flex items-center gap-3">
          <span className={`text-xs font-bold px-2.5 py-1 rounded-full border select-none ${page.status === PageStatus.DONE ? 'bg-green-50 text-green-700 border-green-200' :
              page.status === PageStatus.CORRECTED ? 'bg-blue-50 text-blue-700 border-blue-200' :
                'bg-gray-50 text-gray-600 border-gray-200'
            }`}>
            {page.status}
          </span>
        </div>
      </div>

      {/* Split View Content */}
      <div className="flex-1 flex overflow-hidden">
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
        <div className="w-1/2 h-full bg-white relative">
          <TextEditor
            page={page}
            work={work}
            onSave={handleSave}
            onUnsavedChanges={setHasUnsavedChanges}
            readOnly={!user}
          />
        </div>
      </div>
    </div>
  );
};

export default Workspace;