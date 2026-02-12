import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Page, PageStatus, Annotation, Work } from '../types';
import { getAllTags } from '../services/meiliService';
import { useUser } from '../contexts/UserContext';
import { Save, Loader2, Edit3, ChevronRight, Eye, X } from 'lucide-react';
import MarkdownPreview from './MarkdownPreview';
import AnnotationsTab from './editor/AnnotationsTab';
import HistoryTab from './editor/HistoryTab';
import { fetchWithTimeout } from '../utils/fetchWithTimeout';

// Erimärgi tüüp
interface SpecialCharacter {
  row: number;
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

  const [text, setText] = useState(page.text_content);
  const [status, setStatus] = useState(page.status);
  const [comments, setComments] = useState<Annotation[]>(page.comments);
  const [page_tags, setPageTags] = useState<(string | any)[]>(page.page_tags || []);

  const [isSaving, setIsSaving] = useState(false);

  // Erimärkide state
  const [specialCharacters, setSpecialCharacters] = useState<SpecialCharacter[]>([]);
  const [showCharPanel, setShowCharPanel] = useState(true);
  const [showTranscriptionGuide, setShowTranscriptionGuide] = useState(false);
  const [transcriptionGuideHtml, setTranscriptionGuideHtml] = useState<string>('');

  // Salvestamata muudatuste jälgimine
  const [savedState, setSavedState] = useState({
    text: page.text_content,
    status: page.status,
    comments: page.comments,
    page_tags: page.page_tags
  });

  // Refs for sync scrolling
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const lineNumbersRef = useRef<HTMLDivElement>(null);

  // Arvutame kas on salvestamata muudatusi
  const hasUnsavedChanges =
    text !== savedState.text ||
    status !== savedState.status ||
    JSON.stringify(comments) !== JSON.stringify(savedState.comments) ||
    JSON.stringify(page_tags) !== JSON.stringify(savedState.page_tags);

  useEffect(() => {
    setText(page.text_content);
    setStatus(page.status);
    setComments(page.comments);
    setPageTags(page.page_tags);
    // Uuendame ka salvestatud olekut uue lehe laadimisel
    setSavedState({
      text: page.text_content,
      status: page.status,
      comments: page.comments,
      page_tags: page.page_tags
    });
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

  // Teavitame parent komponenti muudatuste olekust (ainult lokaalsed muudatused)
  useEffect(() => {
    onUnsavedChanges?.(hasUnsavedChanges);
  }, [hasUnsavedChanges, onUnsavedChanges]);

  // Laadime erimärgid JSON failist
  useEffect(() => {
    const loadSpecialCharacters = async () => {
      try {
        const response = await fetchWithTimeout('/special_characters.json', { timeout: 5000 });
        if (response.ok) {
          const data = await response.json();
          setSpecialCharacters(data.characters || []);
        }
      } catch (e) {
        console.warn('Erimärkide laadimine ebaõnnestus:', e);
      }
    };
    loadSpecialCharacters();
  }, []);

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

  // Erimärgi sisestamine või teksti ümbritsemine
  const insertCharacter = useCallback((char: string, e?: React.MouseEvent) => {
    if (e) e.preventDefault();
    if (!textareaRef.current || readOnly) return;

    const textarea = textareaRef.current;
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const isSelection = start !== end;
    const selectedText = text.substring(start, end);

    let insertValue = char;
    let newCursorPos = start + char.length;

    // Logic for specific markers
    if (char === '**') {
      insertValue = isSelection ? `**${selectedText}**` : `****`;
      newCursorPos = isSelection ? end + 4 : start + 2;
    } else if (char === '*') {
      insertValue = isSelection ? `*${selectedText}*` : `**`;
      newCursorPos = isSelection ? end + 2 : start + 1;
    } else if (char === '~') {
      insertValue = isSelection ? `~${selectedText}~` : `~~`;
      newCursorPos = isSelection ? end + 2 : start + 1;
    } else if (char === '[[m: ') {
      insertValue = isSelection ? `[[m: ${selectedText}]]` : `[[m: ]]`;
      newCursorPos = isSelection ? end + 6 : start + 5;
    } else if (char === '[^1]') {
      // Kui tekst on valitud, lisa märgis selle lõppu (nt "sõna[^1]")
      // Kui valikut pole, lihtsalt sisesta märgis
      insertValue = isSelection ? `${selectedText}[^1]` : `[^1]`
      newCursorPos = isSelection ? end + 4 : start + 4;
    }

    // Use document.execCommand to keep undo/redo stack intact
    textarea.focus();
    const success = document.execCommand('insertText', false, insertValue);

    // Fallback if execCommand fails (though it works in all modern browsers for textarea)
    if (!success) {
      const newText = text.substring(0, start) + insertValue + text.substring(end);
      setText(newText);
    }

    // Set cursor position after the update
    // setTimeout is needed because React/DOM might still be processing the insertText
    setTimeout(() => {
      if (textareaRef.current) {
        textareaRef.current.selectionStart = textareaRef.current.selectionEnd = newCursorPos;
      }
    }, 0);
  }, [text, readOnly]);

  const handleSave = async () => {
    setIsSaving(true);
    const updatedPage: Page = {
      ...page,
      text_content: text,
      status: status,
      comments: comments,
      page_tags: page_tags,
    };

    try {
      await onSave(updatedPage);
      setSavedState({
        text: text,
        status: status,
        comments: comments,
        page_tags: page_tags
      });
    } catch (e: any) {
      console.error("Save error:", e);
      alert(`Viga salvestamisel: ${e.message || "Tundmatu viga"}`);
    } finally {
      setIsSaving(false);
    }
  };

  const handleScroll = (e: React.UIEvent<HTMLElement>) => {
    if (lineNumbersRef.current) {
      lineNumbersRef.current.scrollTop = e.currentTarget.scrollTop;
    }
  };

  // Generate line numbers based on text content
  const lineCount = text.split('\n').length;
  const lineNumbers = Array.from({ length: Math.max(1, lineCount) }, (_, i) => i + 1);

  const toggleCharPanel = () => setShowCharPanel(!showCharPanel);

  return (
    <div className="flex flex-col h-full bg-paper font-sans">

      {/* 1. GLOBAL HEADER - Two rows to prevent overlap */}
      <div className="bg-white border-b border-gray-200 shrink-0 z-20 shadow-sm">
        {/* Row 1: Work Metadata */}
        {work && (
          <div className="px-4 py-1.5 border-b border-gray-50 flex items-center gap-2 text-[11px] text-gray-500 bg-gray-50/50">
            <span className="font-bold text-gray-700 truncate max-w-[200px]">{work.author}</span>
            <span className="text-gray-300">•</span>
            <span className="text-gray-400">{work.year}</span>
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

          {/* RIGHT: Save Button */}
          <button
            onClick={handleSave}
            disabled={isSaving || readOnly}
            className={`flex items-center gap-2 px-5 py-1.5 text-xs font-bold uppercase tracking-wider text-white rounded shadow-sm transition-all active:scale-95 disabled:opacity-50 ${(hasUnsavedChanges || statusDirty) && !readOnly
              ? 'bg-amber-500 hover:bg-amber-600'
              : 'bg-primary-600 hover:bg-primary-700'
              }`}
            title={readOnly ? t('editor.readOnlyHint') : ''}
          >
            {isSaving ? <Loader2 className="animate-spin" size={14} /> : <Save size={14} />}
            {isSaving ? t('editor.saving') : t('editor.save').toUpperCase()}
          </button>
        </div>
      </div>

      {/* Main Content Area */}
      <div className="flex-1 overflow-hidden relative flex flex-col">

        {/* TEXT TAB CONTENT */}
        {activeTab === 'edit' && (
          <>
            {/* 2. SECONDARY TOOLBAR - Editor Controls & Status */}
            <div className="bg-white border-b border-gray-100 flex items-center justify-between px-4 py-1.5 shrink-0 gap-4">

              {/* Editor Tools (Left) */}
              <div className="flex items-center gap-4 overflow-x-auto no-scrollbar">
                {/* View Mode Toggle - ICONS */}
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

                {/* Formatting Toolbar */}
                {viewMode === 'edit' && (
                  <div className="flex items-center gap-1">
                    <div className="w-px h-5 bg-gray-200 mx-2"></div>
                    <button type="button" onClick={() => insertCharacter('**')} className="w-7 h-7 flex items-center justify-center rounded hover:bg-gray-100 font-bold border border-transparent hover:border-gray-200 text-gray-700 font-serif" title={t('editor.tooltips.bold')}>B</button>
                    <button type="button" onClick={() => insertCharacter('*')} className="w-7 h-7 flex items-center justify-center rounded hover:bg-gray-100 italic font-serif border border-transparent hover:border-gray-200 text-gray-700" title={t('editor.tooltips.italic')}>I</button>
                    <button type="button" onClick={() => insertCharacter('~')} className="w-7 h-7 flex items-center justify-center rounded hover:bg-gray-100 font-serif border border-transparent hover:border-gray-200 text-gray-700" title={t('editor.tooltips.fractur')}>𝔉</button>
                    <div className="w-px h-4 bg-gray-300 mx-1"></div>
                    <button type="button" onClick={() => insertCharacter('[[m: ')} className="px-2 h-7 flex items-center justify-center rounded hover:bg-gray-100 text-[11px] text-gray-600 border border-transparent hover:border-gray-200" title={t('editor.tooltips.marginalia')}>Marginalia</button>
                    <button type="button" onClick={() => insertCharacter('[^1]')} className="px-2 h-7 flex items-center justify-center rounded hover:bg-gray-100 text-[11px] text-gray-600 border border-transparent hover:border-gray-200" title={t('editor.tooltips.footnote')}>[^1]</button>
                    <button type="button" onClick={() => insertCharacter('--lk--\n')} className="px-2 h-7 flex items-center justify-center rounded hover:bg-gray-100 text-[11px] text-gray-400 border border-transparent hover:border-gray-200 font-mono" title={t('editor.tooltips.pageBreak')}>--lk--</button>
                  </div>
                )}
              </div>

              {/* Page Status Selector (Right) */}
              {onStatusChange && (
                <div className="flex items-center gap-2 shrink-0">
                  <span className="text-[10px] text-gray-400 uppercase tracking-wide hidden sm:block">{t('status.label')}</span>
                  <select
                    value={currentStatus || page.status}
                    onChange={(e) => onStatusChange(e.target.value as PageStatus)}
                    disabled={readOnly}
                    className={`text-xs font-bold uppercase px-2 py-1 rounded-full border outline-none transition-all cursor-pointer ${readOnly ? 'bg-gray-100 text-gray-400 border-gray-200 cursor-not-allowed' :
                        (currentStatus || page.status) === PageStatus.DONE ? 'bg-green-50 text-green-700 border-green-200 hover:bg-green-100' :
                          (currentStatus || page.status) === PageStatus.IN_PROGRESS ? 'bg-amber-50 text-amber-700 border-amber-200 hover:bg-amber-100' :
                            (currentStatus || page.status) === PageStatus.CORRECTED ? 'bg-blue-50 text-blue-700 border-blue-200 hover:bg-blue-100' :
                              'bg-gray-50 text-gray-700 border-gray-200 hover:bg-gray-100'
                      }`}
                  >
                    {Object.values(PageStatus).map((s) => (
                      <option key={s} value={s}>{t(`common:status.${s}`)}</option>
                    ))}
                  </select>
                </div>
              )}

            </div>

            {/* 3. EDITOR AREA */}
            <div className="flex-1 relative flex overflow-hidden bg-white">
              {/* Line Numbers Column */}
              <div
                ref={lineNumbersRef}
                className="w-12 bg-gray-50 border-r border-gray-200 text-gray-400 font-serif text-[18px] leading-[1.7] text-right py-6 pr-2 select-none overflow-hidden"
              >
                {lineNumbers.map((num) => (
                  <div key={num} className="whitespace-no-wrap">{num}</div>
                ))}
              </div>

              {/* Text Area OR Markdown Preview */}
              {viewMode === 'edit' ? (
                <textarea
                  ref={textareaRef}
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  onScroll={handleScroll}
                  readOnly={readOnly}
                  className={`flex-1 w-full p-6 bg-white outline-none font-serif text-[18px] leading-[1.7] text-gray-800 resize-none whitespace-pre overflow-auto ${readOnly ? 'cursor-default' : ''}`}
                  placeholder={t('editor.placeholder')}
                  spellCheck={false}
                />
              ) : (
                <div
                  className="flex-1 w-full bg-white overflow-auto"
                  onScroll={handleScroll}
                >
                  <MarkdownPreview content={text} />
                </div>
              )}
            </div>

            {/* 4. COLLAPSIBLE FOOTER (Very Compact) */}
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
                  </summary>

                  <div className="px-3 py-1.5 flex flex-wrap items-center justify-between gap-2">
                    {/* Special Characters - Even smaller buttons */}
                    <div className="flex flex-wrap gap-1">
                      {specialCharacters.map((char, idx) => (
                        <button
                          key={idx}
                          type="button"
                          onClick={(e) => insertCharacter(char.character, e)}
                          disabled={readOnly}
                          title={char.name || char.character}
                          className="w-[22px] h-[22px] flex items-center justify-center text-xs font-serif bg-white border border-gray-200 rounded hover:bg-primary-50 hover:border-primary-300 transition-colors shadow-sm"
                        >
                          {char.character}
                        </button>
                      ))}
                    </div>

                    {/* Guide Link (Very Compact) */}
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

            {/* Guide Modal */}
            {
              showTranscriptionGuide && (
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
              )
            }

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
            user={user}
            authToken={authToken}
            onRestore={(content) => {
              setText(content);
              setActiveTab('edit');
            }}
            readOnly={readOnly || false}
          />
        )}

      </div >
    </div >
  );
};

export default TextEditor;