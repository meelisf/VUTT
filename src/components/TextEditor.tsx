import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Page, PageStatus, Annotation, Work } from '../types';
import { useUser } from '../contexts/UserContext';
import { Save, Loader2, Edit3, ChevronRight, Eye, X, Settings2, Wand2, Superscript, SeparatorHorizontal } from 'lucide-react';
import AnnotationsTab from './editor/AnnotationsTab';
import HistoryTab from './editor/HistoryTab';
import CharSetEditor from './editor/CharSetEditor';
import { vuttMarkupExtension } from './editor/VuttMarkupExtension';
import { vuttTheme } from './editor/VuttTheme';
import { fetchWithTimeout } from '../utils/fetchWithTimeout';
import { FILE_API_URL } from '../config';

// CM6 impordid
import { EditorView, lineNumbers, keymap } from '@codemirror/view';
import { EditorState, EditorSelection, Compartment } from '@codemirror/state';
import { history, historyKeymap, defaultKeymap } from '@codemirror/commands';

// Erimärgi tüüp
interface SpecialCharacter {
  row?: number;
  character: string;
  name?: string;
  keyboard_code?: number | null;
}

interface TextEditorProps {
  page: Page;
  work?: Work;
  onSave: (updatedPage: Page) => Promise<void>;
  onUnsavedChanges?: (hasChanges: boolean) => void;
  onOpenMetaModal?: () => void;
  readOnly?: boolean;
  statusDirty?: boolean;
  currentStatus?: PageStatus | null;
  onStatusChange?: (status: PageStatus) => void;
}

type TabType = 'edit' | 'annotate' | 'history';
type ViewMode = 'edit' | 'read';

const TextEditor: React.FC<TextEditorProps> = ({ page, work, onSave, onUnsavedChanges, onOpenMetaModal, readOnly = false, statusDirty = false, currentStatus, onStatusChange }) => {
  const { t, i18n } = useTranslation(['workspace', 'common']);
  const { user, authToken } = useUser();
  const lang = i18n.language || 'et';
  const [activeTab, setActiveTab] = useState<TabType>('edit');

  // Salvesta viewMode localStorage'sse, et see säiliks lehekülgede vahel liikudes
  const [viewMode, setViewMode] = useState<ViewMode>(() => {
    if (readOnly) return 'read';
    const saved = localStorage.getItem('vutt_viewMode');
    return saved === 'read' ? 'read' : 'edit';
  });
  const handleViewModeChange = useCallback((mode: ViewMode) => {
    setViewMode(mode);
    localStorage.setItem('vutt_viewMode', mode);
  }, []);

  // Redaktori sisu muudatuste jälgimine (asendab vana `text` state'i)
  const [isDirty, setIsDirty] = useState(false);
  const [status, setStatus] = useState(page.status);
  const [comments, setComments] = useState<Annotation[]>(page.comments);
  const [page_tags, setPageTags] = useState<(string | any)[]>(page.page_tags || []);
  const [isSaving, setIsSaving] = useState(false);

  // Re-OCR state
  type ReocrStatus = 'idle' | 'uploading' | 'processing' | 'done' | 'error';
  const [reocrStatus, setReocrStatus] = useState<ReocrStatus>('idle');
  const [reocrText, setReocrText] = useState<string | null>(null);
  const [reocrError, setReocrError] = useState<string | null>(null);
  const reocrPollRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Erimärkide state
  const [specialCharacters, setSpecialCharacters] = useState<SpecialCharacter[]>([]);
  const [isCustomChars, setIsCustomChars] = useState(false);
  const [showCharPanel, setShowCharPanel] = useState(true);
  const [showCharEditor, setShowCharEditor] = useState(false);
  const [showTranscriptionGuide, setShowTranscriptionGuide] = useState(false);
  const [transcriptionGuideHtml, setTranscriptionGuideHtml] = useState<string>('');

  // Salvestamata muudatuste jälgimine (teksti osa: isDirty; muu: savedState)
  const [savedState, setSavedState] = useState({
    status: page.status,
    comments: page.comments,
    page_tags: page.page_tags,
  });

  // CM6 refs
  const editorContainerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const editableCompartmentRef = useRef(new Compartment());
  const handleSaveRef = useRef<() => void>(() => {});
  const wrapWithTagRef = useRef<(tag: string) => void>(() => {});
  const isSavingRef = useRef(false);

  // Arvutame kas on salvestamata muudatusi
  const hasUnsavedChanges =
    isDirty ||
    status !== savedState.status ||
    JSON.stringify(comments) !== JSON.stringify(savedState.comments) ||
    JSON.stringify(page_tags) !== JSON.stringify(savedState.page_tags);

  // --- CM6 editori loomine (üks kord mount'il) ---
  useEffect(() => {
    if (!editorContainerRef.current) return;

    const copyHandler = (event: ClipboardEvent, view: EditorView) => {
      // Nutikas kopeerimine: liidab read tühikuga, jätab poolitused, eemaldab XML tägid
      const { from, to } = view.state.selection.main;
      if (from === to) return false;
      const selected = view.state.doc.sliceString(from, to);
      const lines = selected.split('\n');
      let result = '';
      for (let i = 0; i < lines.length; i++) {
        if (i === 0) {
          result = lines[i];
        } else if (result.endsWith('-') || result.endsWith('⸗')) {
          result += lines[i]; // poolitus — liida otse
        } else if (result.endsWith(' ') || lines[i].startsWith(' ')) {
          result += lines[i]; // tühik juba olemas
        } else {
          result += ' ' + lines[i];
        }
      }
      // Eemaldame XML tägid kopeeritud tekstist
      const clean = result.replace(/<\/?[a-z]+[^>]*>/g, '').trim();
      event.clipboardData?.setData('text/plain', clean);
      event.preventDefault();
      return true;
    };

    const view = new EditorView({
      state: EditorState.create({
        doc: page.text_content,
        extensions: [
          lineNumbers(),
          history(),
          keymap.of([
            ...defaultKeymap,
            ...historyKeymap,
            { key: 'Mod-s', run: () => { handleSaveRef.current(); return true; } },
            { key: 'Mod-b', run: () => { wrapWithTagRef.current('b'); return true; } },
            { key: 'Mod-i', run: () => { wrapWithTagRef.current('i'); return true; } },
            { key: 'Mod-k', run: () => { wrapWithTagRef.current('cs'); return true; } },
          ]),
          editableCompartmentRef.current.of(
            EditorView.editable.of(!readOnly)
          ),
          vuttMarkupExtension,
          vuttTheme,
          EditorView.updateListener.of((update) => {
            if (update.docChanged) setIsDirty(true);
          }),
          EditorView.domEventHandlers({ copy: copyHandler }),
        ],
      }),
      parent: editorContainerRef.current,
    });

    viewRef.current = view;
    return () => {
      view.destroy();
      viewRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Ainult mount'il — page.text_content on algväärtus

  // Uuendame editeeritavust viewMode ja readOnly muutmisel
  useEffect(() => {
    viewRef.current?.dispatch({
      effects: editableCompartmentRef.current.reconfigure(
        EditorView.editable.of(viewMode === 'edit' && !readOnly)
      ),
    });
  }, [viewMode, readOnly]);

  // Uuendame editori sisu lehe vahetusel
  useEffect(() => {
    setStatus(page.status);
    setComments(page.comments);
    setPageTags(page.page_tags || []);
    setSavedState({ status: page.status, comments: page.comments, page_tags: page.page_tags });
    setIsDirty(false);

    const view = viewRef.current;
    if (view) {
      const currentText = view.state.doc.toString();
      if (currentText !== page.text_content) {
        view.dispatch({
          changes: { from: 0, to: currentText.length, insert: page.text_content },
        });
      }
    }
  }, [page]);

  // Hoiatus brauseri sulgemise/refreshi korral
  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (hasUnsavedChanges) {
        e.preventDefault();
        e.returnValue = '';
        return '';
      }
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [hasUnsavedChanges]);

  // Teavitame parent komponenti muudatuste olekust
  useEffect(() => {
    onUnsavedChanges?.(hasUnsavedChanges);
  }, [hasUnsavedChanges, onUnsavedChanges]);

  // Laadime erimärgid: sisselogitud kasutajal isiklik komplekt, muidu globaalne
  useEffect(() => {
    const loadSpecialCharacters = async () => {
      try {
        if (authToken) {
          const response = await fetchWithTimeout(`${FILE_API_URL}/user-chars?token=${authToken}`, { timeout: 5000 });
          if (response.ok) {
            const data = await response.json();
            if (data.is_custom) {
              setSpecialCharacters(data.characters || []);
              setIsCustomChars(true);
              return;
            }
          }
        }
        const response = await fetchWithTimeout('/special_characters.json', { timeout: 5000 });
        if (response.ok) {
          const data = await response.json();
          setSpecialCharacters(data.characters || []);
          setIsCustomChars(false);
        }
      } catch (e) {
        console.warn('Erimärkide laadimine ebaõnnestus:', e);
      }
    };
    loadSpecialCharacters();
  }, [authToken]);

  // Laadime transkribeerimise juhendi HTML failist
  useEffect(() => {
    const loadTranscriptionGuide = async () => {
      try {
        const fileSuffix = lang === 'en' ? '_en' : '';
        const response = await fetchWithTimeout(`/transcription_guide${fileSuffix}.html`, { timeout: 5000 });
        if (response.ok) {
          const html = await response.text();
          const styleMatch = html.match(/<style[^>]*>([\s\S]*?)<\/style>/i);
          const bodyMatch = html.match(/<body[^>]*>([\s\S]*)<\/body>/i);
          const styleTag = styleMatch ? `<style>${styleMatch[1]}</style>` : '';
          const bodyContent = bodyMatch ? bodyMatch[1] : html;
          setTranscriptionGuideHtml(styleTag + bodyContent);
        }
      } catch (e) {
        console.warn('Transkribeerimise juhendi laadimine ebaõnnestus:', e);
      }
    };
    loadTranscriptionGuide();
  }, [lang]);

  // --- Salvestamine ---
  const handleSave = useCallback(async () => {
    if (isSavingRef.current) return;
    isSavingRef.current = true;
    setIsSaving(true);

    const text = viewRef.current?.state.doc.toString() ?? '';
    const updatedPage: Page = { ...page, text_content: text, status, comments, page_tags };

    try {
      await onSave(updatedPage);
      setSavedState({ status, comments, page_tags });
      setIsDirty(false);
    } catch (e: any) {
      console.error('Save error:', e);
      alert(`Viga salvestamisel: ${e.message || 'Tundmatu viga'}`);
    } finally {
      isSavingRef.current = false;
      setIsSaving(false);
    }
  }, [page, status, comments, page_tags, onSave]);

  // Uuendame refid, et keymap saaks alati uusima versiooni
  useEffect(() => { handleSaveRef.current = handleSave; }, [handleSave]);

  // --- Toolbar toimingud ---
  const wrapWithTag = useCallback((tag: string) => {
    const view = viewRef.current;
    if (!view || readOnly) return;
    const { from, to } = view.state.selection.main;
    const openTag = `<${tag}>`;
    const closeTag = `</${tag}>`;
    const docText = view.state.doc.toString();

    // Toggle off: kui valik on juba täpselt selle tagi sees, eemalda tägid.
    // CM6 peidab tägid, seega kasutaja valib SISU — from on kohe avatägi järel,
    // to kohe sulgtägi ees.
    const beforeFrom = from >= openTag.length ? docText.slice(from - openTag.length, from) : '';
    const afterTo = docText.slice(to, to + closeTag.length);

    if (beforeFrom === openTag && afterTo === closeTag) {
      view.dispatch({
        changes: [
          { from: from - openTag.length, to: from, insert: '' },
          { from: to, to: to + closeTag.length, insert: '' },
        ],
        selection: EditorSelection.range(from - openTag.length, to - openTag.length),
      });
      view.focus();
      return;
    }

    if (from === to) {
      // Valik puudub: sisesta <tag></tag>, pane kursor tägide vahele
      view.dispatch({
        changes: { from, insert: openTag + closeTag },
        selection: EditorSelection.cursor(from + openTag.length),
      });
    } else {
      // Mähkime valiku tägidega
      view.dispatch({
        changes: [{ from, insert: openTag }, { from: to, insert: closeTag }],
        selection: EditorSelection.range(from + openTag.length, to + openTag.length),
      });
    }
    view.focus();
  }, [readOnly]);

  useEffect(() => { wrapWithTagRef.current = wrapWithTag; }, [wrapWithTag]);

  const insertAtCursor = useCallback((text: string) => {
    const view = viewRef.current;
    if (!view || readOnly) return;
    view.dispatch(view.state.replaceSelection(text));
    view.focus();
  }, [readOnly]);

  // Erimärgi sisestamine (toolbar footer)
  const insertSpecialChar = useCallback((char: string, e?: React.MouseEvent) => {
    if (e) e.preventDefault();
    insertAtCursor(char);
  }, [insertAtCursor]);

  // Re-OCR: pollimise puhastus unmount'il
  useEffect(() => {
    return () => {
      if (reocrPollRef.current) clearTimeout(reocrPollRef.current);
    };
  }, []);

  const handleReOcr = useCallback(async () => {
    if (!page.image_url || !authToken) return;
    const pageFilename = page.image_url.split('/').pop();
    if (!pageFilename) return;

    if (reocrPollRef.current) clearTimeout(reocrPollRef.current);
    setReocrStatus('uploading');
    setReocrText(null);
    setReocrError(null);

    try {
      const res = await fetchWithTimeout(`${FILE_API_URL}/admin/work/${page.work_id}/reocr-page`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ page_filename: pageFilename, auth_token: authToken }),
        timeout: 30000,
      });
      if (!res.ok) {
        const d = await res.json();
        throw new Error(d.detail || 'Re-OCR alustamine ebaõnnestus');
      }
      const { job_id } = await res.json();
      setReocrStatus('processing');

      const poll = async () => {
        try {
          const pr = await fetchWithTimeout(
            `${FILE_API_URL}/admin/reocr/${job_id}/status?token=${authToken}`,
            { timeout: 10000 }
          );
          if (!pr.ok) throw new Error('Polling ebaõnnestus');
          const pd = await pr.json();
          if (pd.status === 'done') {
            setReocrStatus('done');
            setReocrText(pd.text ?? '');
          } else if (pd.status === 'error') {
            setReocrStatus('error');
            setReocrError(pd.error || 'Tundmatu viga');
          } else {
            reocrPollRef.current = setTimeout(poll, 3000);
          }
        } catch {
          reocrPollRef.current = setTimeout(poll, 4000);
        }
      };
      reocrPollRef.current = setTimeout(poll, 3000);
    } catch (e: any) {
      setReocrStatus('error');
      setReocrError(e.message || 'Viga');
    }
  }, [page.image_url, page.work_id, authToken]);

  const applyReOcr = useCallback(() => {
    if (reocrText !== null) {
      const view = viewRef.current;
      if (view) {
        view.dispatch({
          changes: { from: 0, to: view.state.doc.length, insert: reocrText },
        });
        setIsDirty(true);
      }
    }
    setReocrStatus('idle');
    setReocrText(null);
  }, [reocrText]);

  const dismissReOcr = useCallback(() => {
    if (reocrPollRef.current) clearTimeout(reocrPollRef.current);
    setReocrStatus('idle');
    setReocrText(null);
    setReocrError(null);
  }, []);

  const toggleCharPanel = () => setShowCharPanel(!showCharPanel);

  return (
    <div className="flex flex-col h-full bg-paper font-sans">

      {/* 1. GLOBAL HEADER */}
      <div className="bg-white border-b border-gray-200 shrink-0 z-20 shadow-sm">
        {/* Row 1: Work Metadata */}
        {work && (
          <div className="px-4 py-1.5 border-b border-gray-50 flex items-center gap-2 text-[11px] text-gray-500 bg-gray-50/50">
            <span className="font-bold text-gray-700 truncate max-w-[200px]">{work.creators?.find(c => c.role === 'praeses' || c.role === 'auctor')?.name || work.creators?.[0]?.name || ''}</span>
            <span className="text-gray-300">•</span>
            <span className="text-gray-400">{work.year_display || work.year}</span>
            <span className="text-gray-300">•</span>
            <span className="italic truncate flex-1">{work.title}</span>
          </div>
        )}

        {/* Row 2: Tabs and Save button */}
        <div className="px-4 py-2 flex items-center justify-between gap-4">
          {/* LEFT: Main Tabs */}
          <div className="flex bg-gray-100 p-0.5 rounded-lg shadow-inner">
            <button
              onClick={() => setActiveTab('edit')}
              className={`px-4 py-1.5 text-xs font-bold rounded-md transition-all ${activeTab === 'edit' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
            >
              {t('tabs.edit').toUpperCase()}
            </button>
            <button
              onClick={() => setActiveTab('annotate')}
              className={`px-4 py-1.5 text-xs font-bold rounded-md transition-all ${activeTab === 'annotate' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
            >
              {t('tabs.info').toUpperCase()}
            </button>
            <button
              onClick={() => setActiveTab('history')}
              className={`px-4 py-1.5 text-xs font-bold rounded-md transition-all ${activeTab === 'history' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
            >
              {t('tabs.history').toUpperCase()}
            </button>
          </div>

          {/* RIGHT: nupud — peidetud sisselogimata kasutajalt */}
          {!readOnly && (
            <div className="flex items-center gap-2">
              {/* Re-OCR nupp — ainult adminile */}
              {user?.role === 'admin' && (
                <button
                  onClick={handleReOcr}
                  disabled={reocrStatus !== 'idle'}
                  title={t('editor.reocr.button')}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold uppercase tracking-wider text-white rounded shadow-sm transition-all active:scale-95 disabled:opacity-60 bg-emerald-600 hover:bg-emerald-700"
                >
                  {reocrStatus === 'uploading' || reocrStatus === 'processing'
                    ? <Loader2 className="animate-spin" size={12} />
                    : <Wand2 size={12} />}
                  {reocrStatus === 'uploading'
                    ? t('editor.reocr.uploading')
                    : reocrStatus === 'processing'
                      ? t('editor.reocr.processing')
                      : t('editor.reocr.button')}
                </button>
              )}
              <button
                onClick={handleSave}
                disabled={isSaving}
                className={`flex items-center gap-2 px-5 py-1.5 text-xs font-bold uppercase tracking-wider text-white rounded shadow-sm transition-all active:scale-95 disabled:opacity-50 ${(hasUnsavedChanges || statusDirty)
                  ? 'bg-amber-500 hover:bg-amber-600'
                  : 'bg-primary-600 hover:bg-primary-700'
                  }`}
              >
                {isSaving ? <Loader2 className="animate-spin" size={14} /> : <Save size={14} />}
                {isSaving ? t('editor.saving') : t('editor.save').toUpperCase()}
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Main Content Area */}
      <div className="flex-1 overflow-hidden relative flex flex-col">

        {/* TEXT TAB CONTENT */}
        {activeTab === 'edit' && (
          <>
            {/* 2. SECONDARY TOOLBAR */}
            <div className="bg-white border-b border-gray-100 flex items-center justify-between px-4 py-1.5 shrink-0 gap-4">

              {/* Editor Tools (Left) */}
              <div className="flex items-center gap-4 overflow-x-auto no-scrollbar">
                {/* View Mode Toggle */}
                <div className="flex bg-gray-100 p-0.5 rounded-md border border-gray-200">
                  <button
                    onClick={() => handleViewModeChange('edit')}
                    disabled={readOnly}
                    className={`p-1.5 rounded transition-all flex items-center justify-center ${viewMode === 'edit' ? 'bg-amber-50 text-amber-600 shadow-sm' : 'text-gray-400 hover:text-gray-600'}`}
                  >
                    <Edit3 size={16} />
                  </button>
                  <button
                    onClick={() => handleViewModeChange('read')}
                    className={`p-1.5 rounded transition-all flex items-center justify-center ${viewMode === 'read' ? 'bg-blue-50 text-blue-600 shadow-sm' : 'text-gray-400 hover:text-gray-600'}`}
                  >
                    <Eye size={16} />
                  </button>
                </div>

                {/* Formatting Toolbar — ainult edit mode'is */}
                {viewMode === 'edit' && (
                  <div className="flex items-center gap-1">
                    <div className="w-px h-5 bg-gray-200 mx-2"></div>
                    <button type="button" onClick={() => wrapWithTag('b')} className="w-7 h-7 flex items-center justify-center rounded hover:bg-gray-100 font-bold border border-transparent hover:border-gray-200 text-gray-700 font-serif" title={`${t('editor.tooltips.bold')} (Ctrl+B)`}>B</button>
                    <button type="button" onClick={() => wrapWithTag('i')} className="w-7 h-7 flex items-center justify-center rounded hover:bg-gray-100 italic font-serif border border-transparent hover:border-gray-200 text-gray-700" title={`${t('editor.tooltips.italic')} (Ctrl+I)`}>I</button>
                    <button type="button" onClick={() => wrapWithTag('cs')} className="w-7 h-7 flex items-center justify-center rounded hover:bg-gray-100 font-serif border border-transparent hover:border-gray-200 text-gray-700" title={`${t('editor.tooltips.fractur')} (Ctrl+K)`}>𝔉</button>
                    <div className="w-px h-4 bg-gray-300 mx-1"></div>
                    <button type="button" onClick={() => wrapWithTag('m')} className="px-2 h-7 flex items-center justify-center rounded hover:bg-gray-100 text-[11px] text-gray-600 border border-transparent hover:border-gray-200" title={t('editor.tooltips.marginalia')}>Marginalia</button>
                    <button type="button" onClick={() => insertAtCursor('<fn>1</fn>')} className="w-7 h-7 flex items-center justify-center rounded hover:bg-gray-100 border border-transparent hover:border-gray-200 text-gray-600" title={t('editor.tooltips.footnote')}><Superscript size={14} /></button>
                    <button type="button" onClick={() => insertAtCursor('<pb/>\n')} className="w-7 h-7 flex items-center justify-center rounded hover:bg-gray-100 border border-transparent hover:border-gray-200 text-gray-400" title={t('editor.tooltips.pageBreak')}><SeparatorHorizontal size={14} /></button>
                  </div>
                )}
              </div>

              {/* Page Status (Right) */}
              {(() => {
                const st = currentStatus || page.status;
                const colorClass =
                  st === PageStatus.DONE ? 'bg-green-50 text-green-700 border-green-200' :
                  st === PageStatus.IN_PROGRESS ? 'bg-amber-50 text-amber-700 border-amber-200' :
                  st === PageStatus.CORRECTED ? 'bg-blue-50 text-blue-700 border-blue-200' :
                  'bg-gray-50 text-gray-700 border-gray-200';
                return (
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="text-[10px] text-gray-400 uppercase tracking-wide hidden sm:block">{t('status.label')}</span>
                    {onStatusChange ? (
                      <select
                        value={st}
                        onChange={(e) => onStatusChange(e.target.value as PageStatus)}
                        className={`text-xs font-bold uppercase px-2 py-1 rounded-full border outline-none transition-all cursor-pointer ${colorClass} hover:opacity-80`}
                      >
                        {Object.values(PageStatus).map((s) => (
                          <option key={s} value={s}>{t(`common:status.${s}`)}</option>
                        ))}
                      </select>
                    ) : (
                      <span
                        className={`text-xs font-bold uppercase px-2 py-1 rounded-full border cursor-help ${colorClass}`}
                        title={t(`common:statusHelp.${st}`)}
                      >
                        {t(`common:status.${st}`)}
                      </span>
                    )}
                  </div>
                );
              })()}
            </div>

            {/* Re-OCR käimasoleku bänner */}
            {(reocrStatus === 'uploading' || reocrStatus === 'processing') && (
              <div className="shrink-0 bg-emerald-50 border-b border-emerald-200 px-4 py-2 flex items-center gap-2 text-xs text-emerald-800">
                <Loader2 className="animate-spin shrink-0" size={12} />
                {t('editor.reocr.inProgress')}
              </div>
            )}

            {/* 3. EDITOR AREA — CM6 EditorView */}
            <div className="flex-1 relative flex overflow-hidden bg-white">

              {/* Re-OCR tulemus overlay */}
              {(reocrStatus === 'done' || reocrStatus === 'error') && (
                <div className="absolute inset-0 z-20 bg-white/95 flex flex-col">
                  <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 shrink-0">
                    <span className="text-sm font-semibold text-gray-800">
                      {reocrStatus === 'error' ? t('editor.reocr.error') : t('editor.reocr.modalTitle')}
                    </span>
                    <button onClick={dismissReOcr} className="text-gray-400 hover:text-gray-600">
                      <X size={16} />
                    </button>
                  </div>
                  {reocrStatus === 'error' ? (
                    <div className="flex-1 flex items-center justify-center p-6 text-sm text-red-600">
                      {reocrError}
                    </div>
                  ) : (
                    <>
                      <p className="px-4 pt-3 pb-1 text-xs text-gray-500 shrink-0">{t('editor.reocr.modalHint')}</p>
                      <div className="flex-1 overflow-auto px-4 pb-2">
                        <pre className="font-serif text-[15px] leading-[1.7] text-gray-800 whitespace-pre-wrap">{reocrText}</pre>
                      </div>
                      <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-gray-200 shrink-0">
                        <button
                          onClick={dismissReOcr}
                          className="px-4 py-1.5 text-xs font-medium text-gray-600 bg-gray-100 hover:bg-gray-200 rounded transition-colors"
                        >
                          {t('editor.reocr.cancel')}
                        </button>
                        <button
                          onClick={applyReOcr}
                          className="px-4 py-1.5 text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-700 rounded shadow-sm transition-colors"
                        >
                          {t('editor.reocr.apply')}
                        </button>
                      </div>
                    </>
                  )}
                </div>
              )}

              {/* CM6 konteiner — täidab kogu ala */}
              <div ref={editorContainerRef} className="flex-1 overflow-hidden" />
            </div>

            {/* 4. COLLAPSIBLE FOOTER (erimärkide paneel) */}
            {viewMode === 'edit' && (
              <div className="border-t border-gray-200 bg-white shrink-0">
                <details className="group" open={showCharPanel}>
                  <summary
                    className="flex items-center gap-2 px-4 py-1.5 cursor-pointer hover:bg-gray-50 text-[11px] font-medium text-gray-500 select-none outline-none transition-colors border-b border-transparent group-open:border-gray-50"
                    onClick={(e) => { e.preventDefault(); toggleCharPanel(); }}
                  >
                    <div className={`transition-transform duration-200 text-gray-400 ${showCharPanel ? 'rotate-90' : ''}`}>
                      <ChevronRight size={12} />
                    </div>
                    {t('editor.specialChars')}
                    {isCustomChars && (
                      <span className="text-[10px] text-primary-500 font-normal">✦</span>
                    )}
                    {user && (
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); setShowCharEditor(true); }}
                        className="ml-auto text-gray-400 hover:text-gray-600 transition-colors"
                        title={t('editor.editChars', 'Kohanda märgikomplekti')}
                      >
                        <Settings2 size={12} />
                      </button>
                    )}
                  </summary>

                  <div className="px-3 py-1.5 flex flex-wrap items-center justify-between gap-2">
                    <div className="flex flex-wrap gap-1">
                      {specialCharacters.map((char, idx) => (
                        <button
                          key={idx}
                          type="button"
                          onClick={(e) => insertSpecialChar(char.character, e)}
                          disabled={readOnly}
                          title={char.name || char.character}
                          className="w-[22px] h-[22px] flex items-center justify-center text-xs font-serif bg-white border border-gray-200 rounded hover:bg-primary-50 hover:border-primary-300 transition-colors shadow-sm"
                        >
                          {char.character}
                        </button>
                      ))}
                    </div>

                    <button
                      onClick={() => setShowTranscriptionGuide(true)}
                      className="text-[11px] text-primary-600 hover:text-primary-800 hover:underline py-1 transition-colors"
                    >
                      {t('editor.openGuide')}
                    </button>
                  </div>
                </details>
              </div>
            )}

            {/* CharSet Editor Modal */}
            {showCharEditor && authToken && (
              <CharSetEditor
                characters={specialCharacters}
                isCustom={isCustomChars}
                authToken={authToken}
                onClose={() => setShowCharEditor(false)}
                onSaved={(chars, custom) => {
                  setSpecialCharacters(chars);
                  setIsCustomChars(custom);
                }}
              />
            )}

            {/* Guide Modal */}
            {showTranscriptionGuide && (
              <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setShowTranscriptionGuide(false)}>
                <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full mx-4 max-h-[80vh] overflow-hidden" onClick={e => e.stopPropagation()}>
                  <div className="flex items-center justify-between p-4 border-b border-gray-200">
                    <h2 className="text-lg font-bold text-gray-800">{t('editor.guideTitle')}</h2>
                    <button onClick={() => setShowTranscriptionGuide(false)} className="text-gray-500 hover:text-gray-700">
                      <X size={20} />
                    </button>
                  </div>
                  <div
                    className="p-6 overflow-y-auto max-h-[calc(80vh-60px)]"
                    dangerouslySetInnerHTML={{ __html: transcriptionGuideHtml || `<p>${t('common:labels.loading')}...</p>` }}
                  />
                </div>
              </div>
            )}
          </>
        )}

        {/* ANNOTATIONS TAB */}
        {activeTab === 'annotate' && (
          <AnnotationsTab
            work={work}
            page={page}
            page_tags={page_tags}
            setPageTags={setPageTags}
            comments={comments}
            setComments={setComments}
            readOnly={readOnly || false}
            user={user}
            authToken={authToken}
            onOpenMetaModal={onOpenMetaModal}
            lang={lang}
          />
        )}

        {/* HISTORY TAB */}
        {activeTab === 'history' && (
          <HistoryTab
            page={page}
            work={work}
            user={user}
            authToken={authToken}
            onRestore={(content) => {
              const view = viewRef.current;
              if (view) {
                view.dispatch({
                  changes: { from: 0, to: view.state.doc.length, insert: content },
                });
                setIsDirty(true);
              }
              setActiveTab('edit');
            }}
            readOnly={readOnly || false}
          />
        )}
      </div>
    </div>
  );
};

export default TextEditor;
