import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { getPage, savePage, getWorkMetadata } from '../services/meiliService';
import { Page, PageStatus, Work } from '../types';
import ImageViewer from '../components/ImageViewer';
import TextEditor from '../components/TextEditor';
import { useUser } from '../contexts/UserContext';
import { ChevronLeft, ChevronRight, AlertTriangle, Search, Home, Edit3, X, Save } from 'lucide-react';
import { FILE_API_URL } from '../config';

const Workspace: React.FC = () => {
  const { user, authToken } = useUser();
  const { workId, pageNum } = useParams<{ workId: string, pageNum: string }>();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState<Page | null>(null);
  const [work, setWork] = useState<Work | undefined>(undefined);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);

  // Metaandmete muutmise olekud
  const [isMetaModalOpen, setIsMetaModalOpen] = useState(false);
  const [metaForm, setMetaForm] = useState({
    pealkiri: '',
    autor: '',
    respondens: '',
    aasta: 0,
    teose_tags: '',
    ester_id: '',
    external_url: ''
  });
  const [suggestions, setSuggestions] = useState<{ authors: string[], tags: string[] }>({ authors: [], tags: [] });

  const currentPageNum = parseInt(pageNum || '1', 10);

  // Lehekülje numbri sisestamise olek
  const [inputPage, setInputPage] = useState(pageNum || '1');

  // Sünkroniseeri sisendväli URL-i muutustega (nt nuppudega navigeerimisel)
  useEffect(() => {
    setInputPage(pageNum || '1');
  }, [pageNum]);

  const handlePageInputSubmit = () => {
    if (!workId) return;
    const newPage = parseInt(inputPage, 10);
    const totalPages = work?.page_count || 0;

    // Kontrollime, et number oleks valiidne ja piires (kui lehekülgede arv on teada)
    if (!isNaN(newPage) && newPage >= 1 && (totalPages === 0 || newPage <= totalPages)) {
      if (newPage !== currentPageNum) {
        if (hasUnsavedChanges) {
          const confirmed = window.confirm('Sul on salvestamata muudatused. Kas soovid kindlasti lahkuda?');
          if (!confirmed) {
            setInputPage(currentPageNum.toString());
            return;
          }
        }
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

  // Lae soovitused (autorid ja tagid) kui modal avatakse
  const fetchSuggestions = async () => {
    try {
      const response = await fetch(`${FILE_API_URL}/get-metadata-suggestions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ auth_token: authToken })
      });
      const data = await response.json();
      if (data.status === 'success') {
        setSuggestions({ authors: data.authors, tags: data.tags });
      }
    } catch (e) {
      console.error("Viga soovituste laadimisel", e);
    }
  };

  const openMetaModal = async () => {
    if (!page) return;
    
    const initialForm = {
      pealkiri: work?.title || page.pealkiri || '',
      autor: work?.author || page.autor || '',
      respondens: work?.respondens || page.respondens || '',
      aasta: work?.year || page.aasta || 0,
      teose_tags: (work?.teose_tags || page.teose_tags || []).join(', '),
      ester_id: work?.ester_id || page.ester_id || '',
      external_url: work?.external_url || page.external_url || ''
    };
    console.log("Avame modaali algandmetega:", initialForm);

    // 1. Ava modal kohe ja täida esialgsete andmetega (fallback)
    setIsMetaModalOpen(true);
    setMetaForm(initialForm);

    // Valmistame ette päringu andmed
    // Saadame alati work_id, server leiab selle järgi kausta ise üles
    let payload: any = { auth_token: authToken, work_id: workId };
    if (page.originaal_kataloog) {
      payload.original_path = page.originaal_kataloog;
    }

    // 2. Küsi serverist otse faili sisu (_metadata.json), et saada värskeim info
    try {
      const response = await fetch(`${FILE_API_URL}/get-work-metadata`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      
      const data = await response.json();
      
      if (data.status === 'success' && data.metadata) {
        const m = data.metadata;
        console.log("Serverist laetud metadata:", m);
        // Uuenda vormi serverist saadud värske infoga
        setMetaForm(prev => ({
          ...prev,
          pealkiri: m.pealkiri !== undefined ? m.pealkiri : prev.pealkiri,
          autor: m.autor !== undefined ? m.autor : prev.autor,
          respondens: m.respondens !== undefined ? m.respondens : prev.respondens,
          aasta: m.aasta ? parseInt(m.aasta) : prev.aasta,
          teose_tags: Array.isArray(m.teose_tags) ? m.teose_tags.join(', ') : (m.teose_tags !== undefined ? m.teose_tags : prev.teose_tags),
          ester_id: m.ester_id !== undefined ? (m.ester_id || '') : prev.ester_id,
          external_url: m.external_url !== undefined ? (m.external_url || '') : prev.external_url
        }));
      }
    } catch (e) {
      console.error("Viga metaandmete laadimisel failiserverist:", e);
    }

    fetchSuggestions();
  };

  const handleSaveMetadata = async () => {
    if (!page || !authToken) return;

    try {
      const tagsArray = metaForm.teose_tags
        .split(',')
        .map(t => t.trim())
        .filter(t => t !== '');

      // ESTER ID puhastamine: toetame nii puhast ID-d kui ka täispikka URL-i
      let cleanEsterId = metaForm.ester_id.trim();
      const esterMatch = cleanEsterId.match(/record=(b\d+)/);
      if (esterMatch) {
        cleanEsterId = esterMatch[1];
      }

      let payload: any = {
        auth_token: authToken,
        work_id: workId, // Põhiline identifikaator
        metadata: {
          pealkiri: metaForm.pealkiri,
          autor: metaForm.autor,
          respondens: metaForm.respondens,
          aasta: metaForm.aasta,
          teose_tags: tagsArray,
          ester_id: cleanEsterId || null,
          external_url: metaForm.external_url.trim() || null
        }
      };

      // Kui meil on kataloog teada, lisame selle optimeerimiseks, aga see pole kohustuslik
      if (page.originaal_kataloog) {
        payload.original_path = page.originaal_kataloog;
      }

      const response = await fetch(`${FILE_API_URL}/update-work-metadata`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      const data = await response.json();
      if (data.status === 'success') {
        // Uuenda kohalikku olekut, et muudatused paistaksid kohe
        setPage({
          ...page,
          pealkiri: metaForm.pealkiri,
          autor: metaForm.autor,
          respondens: metaForm.respondens,
          aasta: metaForm.aasta,
          teose_tags: tagsArray,
          ester_id: cleanEsterId || undefined,
          external_url: metaForm.external_url.trim() || undefined
        });

        // Uuenda ka work objekti, et muudatused (nt ESTER link) ilmuksid kohe TextEditoris
        if (work) {
          setWork({
            ...work,
            title: metaForm.pealkiri,
            author: metaForm.autor,
            respondens: metaForm.respondens,
            year: metaForm.aasta,
            ester_id: cleanEsterId || undefined,
          });
        }

        setIsMetaModalOpen(false);
        alert('Teose andmed salvestatud! Muudatuste nägemiseks otsingus käivita serveris consolidate skript.');
      } else {
        alert('Viga salvestamisel: ' + data.message);
      }
    } catch (e) {
      console.error("Metadata save failed", e);
      alert('Serveri viga andmete salvestamisel.');
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
    // Salvestame ja saame tagasi uuendatud lehe (koos uue ajalooga)
    const savedPage = await savePage(updatedPage, 'Salvestas muudatused', user.name, { token: authToken });
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

  // Navigeerimine tagasi dashboardile
  const handleNavigateBack = () => {
    if (hasUnsavedChanges) {
      const confirmed = window.confirm('Sul on salvestamata muudatused. Kas soovid kindlasti lahkuda?');
      if (!confirmed) return;
    }
    navigate('/');
  };

  // Navigeerimine otsingusse (selle teose piires)
  const handleNavigateToSearch = () => {
    if (hasUnsavedChanges) {
      const confirmed = window.confirm('Sul on salvestamata muudatused. Kas soovid kindlasti lahkuda?');
      if (!confirmed) return;
    }
    navigate(`/search?work=${workId}`);
  };

  return (
    <div className="h-screen flex flex-col bg-gray-100 overflow-hidden">
      {/* Top Navigation Bar */}
      <div className="h-12 bg-white border-b border-gray-200 flex items-center justify-between px-4 shrink-0 shadow-sm z-10">
        <div className="flex items-center gap-2">
          {/* Avaleht */}
          <button
            onClick={handleNavigateBack}
            className="p-1.5 hover:bg-gray-100 rounded-md text-gray-600 transition-colors flex items-center gap-1.5"
            title="Avaleht"
          >
            <Home size={16} />
            <span className="font-bold text-gray-800 tracking-tight hidden sm:inline">VUTT</span>
          </button>
          {/* Otsing */}
          <button
            onClick={handleNavigateToSearch}
            className="p-1.5 hover:bg-primary-50 rounded-md text-primary-600 transition-colors flex items-center gap-1.5 text-sm"
            title="Otsing"
          >
            <Search size={16} />
            <span className="hidden sm:inline">Otsing</span>
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
            <span className="text-sm font-medium text-gray-600">Lk</span>
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

        <div className="flex items-center gap-3">
          <span className={`text-xs font-bold px-2.5 py-1 rounded-full border select-none ${page.status === PageStatus.DONE ? 'bg-green-50 text-green-700 border-green-200' :
              page.status === PageStatus.CORRECTED ? 'bg-blue-50 text-blue-700 border-blue-200' :
                'bg-gray-50 text-gray-600 border-gray-200'
            }`}>
            {page.status}
          </span>
          {/* Admini muutmise nupp - liigutatud paremale poole */}
          {user?.role === 'admin' && (
            <button
              onClick={openMetaModal}
              className="p-1.5 hover:bg-amber-50 rounded-md text-amber-600 transition-colors flex items-center gap-1 text-xs font-medium border border-amber-100 bg-amber-50/30"
              title="Muuda teose metaandmeid"
            >
              <Edit3 size={14} />
              <span className="hidden md:inline">Muuda metaandmeid</span>
            </button>
          )}
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

      {/* Metaandmete muutmise modal */}
      {isMetaModalOpen && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-xl w-full max-w-lg overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-200 flex justify-between items-center bg-gray-50">
              <h3 className="font-bold text-gray-800 flex items-center gap-2">
                <Edit3 size={18} className="text-amber-600" />
                Teose metaandmed
              </h3>
              <button onClick={() => setIsMetaModalOpen(false)} className="text-gray-400 hover:text-gray-600">
                <X size={20} />
              </button>
            </div>
            <div className="p-4 space-y-4">
              <div>
                <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Pealkiri</label>
                <textarea
                  className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:ring-2 focus:ring-primary-500 outline-none"
                  rows={3}
                  value={metaForm.pealkiri}
                  onChange={e => setMetaForm({ ...metaForm, pealkiri: e.target.value })}
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Autor</label>
                  <input
                    list="author-suggestions"
                    className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:ring-2 focus:ring-primary-500 outline-none"
                    value={metaForm.autor}
                    onChange={e => setMetaForm({ ...metaForm, autor: e.target.value })}
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Respondens</label>
                  <input
                    list="author-suggestions"
                    className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:ring-2 focus:ring-primary-500 outline-none"
                    value={metaForm.respondens}
                    onChange={e => setMetaForm({ ...metaForm, respondens: e.target.value })}
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Aasta</label>
                  <input
                    type="number"
                    className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:ring-2 focus:ring-primary-500 outline-none"
                    value={metaForm.aasta}
                    onChange={e => setMetaForm({ ...metaForm, aasta: parseInt(e.target.value) || 0 })}
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Žanrid / Tagid (komadega eraldatud)</label>
                <input
                  list="tag-suggestions"
                  className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:ring-2 focus:ring-primary-500 outline-none"
                  value={metaForm.teose_tags}
                  onChange={e => setMetaForm({ ...metaForm, teose_tags: e.target.value })}
                  placeholder="nt: disputatsioon, plakat"
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-gray-500 uppercase mb-1">ESTER ID või URL</label>
                  <input
                    className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:ring-2 focus:ring-primary-500 outline-none"
                    value={metaForm.ester_id}
                    onChange={e => setMetaForm({ ...metaForm, ester_id: e.target.value })}
                    placeholder="nt: b1234567 või täislink"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Väline URL</label>
                  <input
                    className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:ring-2 focus:ring-primary-500 outline-none"
                    value={metaForm.external_url}
                    onChange={e => setMetaForm({ ...metaForm, external_url: e.target.value })}
                  />
                </div>
              </div>
              <p className="text-[10px] text-gray-400 mt-1 italic">
                Vihje: dissertatsioon, exercitatio ja teesid muutuvad automaatselt disputatsiooniks.
              </p>

              {/* Soovituste nimekirjad */}
              <datalist id="tag-suggestions">
                {suggestions.tags.map(t => <option key={t} value={t} />)}
              </datalist>
              <datalist id="author-suggestions">
                {suggestions.authors.map(a => <option key={a} value={a} />)}
              </datalist>
            </div>
            <div className="px-4 py-3 bg-gray-50 border-t border-gray-200 flex justify-end gap-2">
              <button
                onClick={() => setIsMetaModalOpen(false)}
                className="px-4 py-2 text-sm font-medium text-gray-600 hover:text-gray-800"
              >
                Tühista
              </button>
              <button
                onClick={handleSaveMetadata}
                className="px-4 py-2 bg-amber-600 text-white rounded text-sm font-medium hover:bg-amber-700 flex items-center gap-2"
              >
                <Save size={16} />
                Salvesta muudatused
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Workspace;