import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { Page, PageStatus, Annotation, Work } from '../types';
import { getAllTags, getWorkFullText } from '../services/meiliService';
import { useUser } from '../contexts/UserContext';
import { FILE_API_URL } from '../config';
import { Save, Tag, MessageSquare, Loader2, History, Trash2, Download, X, BookOpen, AlertTriangle, Search, RotateCcw, Shield, ExternalLink, Edit3, ChevronRight, Eye, User } from 'lucide-react';
import MarkdownPreview from './MarkdownPreview';
import EntityPicker from './EntityPicker';
import { getLabel } from '../utils/metadataUtils';

// Git ajaloo kirje tüüp
interface GitHistoryEntry {
  hash: string;
  full_hash: string;
  author: string;
  date: string;
  formatted_date: string;
  message: string;
  is_original: boolean;
}

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
  const navigate = useNavigate();
  const lang = i18n.language || 'et';
  const [activeTab, setActiveTab] = useState<TabType>('edit');
  // Default to 'read' mode for non-logged-in users (readOnly), 'edit' for logged-in users
  const [viewMode, setViewMode] = useState<ViewMode>(readOnly ? 'read' : 'edit');

  const [text, setText] = useState(page.text_content);
  const [status, setStatus] = useState(page.status);
  const [comments, setComments] = useState<Annotation[]>(page.comments);
  const [page_tags, setPageTags] = useState<(string | any)[]>(page.page_tags || []);
  const [newTag, setNewTag] = useState('');
  const [newComment, setNewComment] = useState('');

  // Sõnavara soovitused lehekülje märksõnadele
  const [tagSuggestions, setTagSuggestions] = useState<any[]>([]);

  // Lae soovitused serverist (sama loogika mis MetadataModal-is)
  useEffect(() => {
    const fetchTags = async () => {
      if (!authToken) return;
      try {
        const response = await fetch(`${FILE_API_URL}/get-metadata-suggestions`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ auth_token: authToken })
        });
        const data = await response.json();
        if (data.status === 'success') {
          setTagSuggestions(data.tags || []);
        }
      } catch (e) {
        console.error("Viga märksõnade laadimisel", e);
      }
    };
    fetchTags();
  }, [authToken]);

  // Autocomplete state (vana loogika, jääb alles tagavaraks või eemaldame hiljem)
  const [allAvailableTags, setAllAvailableTags] = useState<string[]>([]);
  const [showTagSuggestions, setShowTagSuggestions] = useState(false);
  const [selectedSuggestionIndex, setSelectedSuggestionIndex] = useState(0);
  const tagInputRef = useRef<HTMLInputElement>(null);
  const suggestionsRef = useRef<HTMLDivElement>(null);

  const [isSaving, setIsSaving] = useState(false);

  // Git ajaloo state
  const [gitHistory, setGitHistory] = useState<GitHistoryEntry[]>([]);
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);
  const [isRestoring, setIsRestoring] = useState(false);

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

  // Load all available tags for autocomplete
  useEffect(() => {
    const loadTags = async () => {
      const fetchedTags = await getAllTags();
      const normalized = Array.from(new Set(fetchedTags.map(t => t.toLowerCase())));
      setAllAvailableTags(normalized);
    };
    loadTags();
  }, []);

  // Laadime erimärgid JSON failist
  useEffect(() => {
    const loadSpecialCharacters = async () => {
      try {
        const response = await fetch('/special_characters.json');
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
        const response = await fetch('/transcription_guide.html');
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
  }, []);

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
      insertValue = isSelection ? `${selectedText}[^1]` : `[^1]`;
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

  // Close suggestions when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (tagInputRef.current && !tagInputRef.current.contains(e.target as Node) &&
        suggestionsRef.current && !suggestionsRef.current.contains(e.target as Node)) {
        setShowTagSuggestions(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

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
      const refreshedTags = await getAllTags();
      setAllAvailableTags(refreshedTags);
    } catch (e: any) {
      console.error("Save error:", e);
      alert(`Viga salvestamisel: ${e.message || "Tundmatu viga"}`);
    } finally {
      setIsSaving(false);
    }
  };

  const loadGitHistory = async () => {
    if (!page.original_path || !page.image_url) {
      console.warn("Ei saa Git ajalugu laadida: puudub original_path või image_url");
      return;
    }

    if (!authToken) {
      alert("Ajaloo laadimiseks pead olema sisse logitud. Palun logi välja ja uuesti sisse.");
      return;
    }

    setIsLoadingHistory(true);
    try {
      const imagePath = page.image_url.split('/').pop() || '';
      const txtFilename = imagePath.replace(/\.(jpg|jpeg|png|gif)$/i, '.txt');

      const response = await fetch(`${FILE_API_URL}/git-history`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          original_path: page.original_path,
          file_name: txtFilename,
          auth_token: authToken
        })
      });

      const data = await response.json();
      if (data.status === 'success') {
        setGitHistory(data.history || []);
      } else {
        console.error("Git ajaloo laadimine ebaõnnestus:", data.message);
        if (data.message?.includes('Autentimine') || data.message?.includes('parool')) {
          alert("Autentimine ebaõnnestus. Palun logi välja ja uuesti sisse.");
        }
      }
    } catch (e) {
      console.error("Git ajaloo laadimine ebaõnnestus:", e);
    } finally {
      setIsLoadingHistory(false);
    }
  };

  const handleGitRestore = async (entry: GitHistoryEntry) => {
    if (!page.original_path || !page.image_url) {
      alert("Taastamine ebaõnnestus: puudub vajalik info");
      return;
    }

    if (!authToken) {
      alert("Taastamiseks pead olema sisse logitud. Palun logi välja ja uuesti sisse.");
      return;
    }

    const confirmMsg = entry.is_original
      ? `Kas soovid taastada ORIGINAAL OCR versiooni?\n\nAutor: ${entry.author}\nKuupäev: ${entry.formatted_date}`
      : `Kas soovid taastada versiooni?\n\nAutor: ${entry.author}\nKuupäev: ${entry.formatted_date}\n\nTekst laaditakse redaktorisse. Muudatuste salvestamiseks pead vajutama "Salvesta".`;

    if (!confirm(confirmMsg)) {
      return;
    }

    setIsRestoring(true);
    try {
      const imagePath = page.image_url.split('/').pop() || '';
      const txtFilename = imagePath.replace(/\.(jpg|jpeg|png|gif)$/i, '.txt');

      const response = await fetch(`${FILE_API_URL}/git-restore`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          original_path: page.original_path,
          file_name: txtFilename,
          commit_hash: entry.full_hash,
          auth_token: authToken
        })
      });

      const data = await response.json();
      if (data.status === 'success' && data.restored_content !== undefined) {
        setText(data.restored_content);
        setActiveTab('edit');
        alert(`Versioon ${entry.formatted_date} (${entry.author}) laaditud redaktorisse.\n\nSalvestamiseks vajuta "Salvesta" nuppu.`);
        loadGitHistory();
      } else {
        alert(`Taastamine ebaõnnestus: ${data.message || 'Tundmatu viga'}`);
      }
    } catch (e: any) {
      console.error("Taastamine ebaõnnestus:", e);
      alert(`Taastamine ebaõnnestus: ${e.message || 'Võrgu viga'}`);
    } finally {
      setIsRestoring(false);
    }
  };

  const handleDownloadImage = async () => {
    if (!page.image_url) {
      alert("Pildi URL puudub!");
      return;
    }

    try {
      const response = await fetch(page.image_url);
      if (!response.ok) throw new Error("Fetch failed");

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      const filename = page.image_url.split('/').pop() || `lk_${page.page_number}.jpg`;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);
    } catch (e) {
      console.warn("Otse allalaadimine ebaõnnestus (CORS?), avan uuel vahelehel.", e);
      window.open(page.image_url, '_blank');
    }
  };

  // Helper: saa string kuju võrdluseks
  const getTagString = (t: string | any) => getLabel(t, lang).toLowerCase();

  const filteredSuggestions = allAvailableTags.filter(
    tag => tag.includes(newTag.toLowerCase()) && !page_tags.some(pt => getTagString(pt) === tag.toLowerCase())
  );

  const addTagFromInput = (tagValue: string) => {
    const trimmed = tagValue.trim().toLowerCase();
    const exists = page_tags.some(pt => getTagString(pt) === trimmed);
    
    if (trimmed && !exists) {
      setPageTags([...page_tags, trimmed]); // Lisa stringina (kui pole EntityPickerist)
      if (!allAvailableTags.includes(trimmed)) {
        setAllAvailableTags(prev => {
          if (prev.includes(trimmed)) return prev;
          return [...prev, trimmed].sort((a, b) => a.localeCompare(b, 'et'));
        });
      }
    }
    setNewTag('');
    setShowTagSuggestions(false);
    setSelectedSuggestionIndex(0);
  };

  const handleTagKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (showTagSuggestions && filteredSuggestions.length > 0) {
        addTagFromInput(filteredSuggestions[selectedSuggestionIndex]);
      } else if (newTag.trim()) {
        addTagFromInput(newTag);
      }
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedSuggestionIndex(prev =>
        Math.min(prev + 1, filteredSuggestions.length - 1)
      );
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedSuggestionIndex(prev => Math.max(prev - 1, 0));
    } else if (e.key === 'Escape') {
      setShowTagSuggestions(false);
    }
  };

  const handleTagInputChange = (value: string) => {
    setNewTag(value);
    setShowTagSuggestions(value.length > 0);
    setSelectedSuggestionIndex(0);
  };

  const removeTag = (tagToRemove: string) => {
    // Eemalda sildi järgi (sest UI-s nupule vajutades saadame stringi)
    setPageTags(page_tags.filter(t => getTagString(t) !== tagToRemove.toLowerCase()));
  };

  const addComment = () => {
    if (!newComment.trim()) return;
    const comment: Annotation = {
      id: Date.now().toString(),
      text: newComment,
      author: user?.name || 'Anonüümne',
      created_at: new Date().toISOString()
    };
    setComments([...comments, comment]);
    setNewComment('');
  };

  const removeComment = (commentId: string) => {
    setComments(comments.filter(c => c.id !== commentId));
  };

  const handleScroll = (e: React.UIEvent<HTMLElement>) => {
    if (lineNumbersRef.current) {
      lineNumbersRef.current.scrollTop = e.currentTarget.scrollTop;
    }
  };

  // Generate line numbers based on text content
  const lineCount = text.split('\n').length;
  const lineNumbers = Array.from({ length: Math.max(1, lineCount) }, (_, i) => i + 1);


  // ... (insertCharacter & other handlers remain the same) ...

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
                    onClick={() => setViewMode('edit')}
                    disabled={readOnly}
                    className={`p-1.5 rounded transition-all flex items-center justify-center ${viewMode === 'edit' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-400 hover:text-gray-600'}`}
                  >
                    <Edit3 size={16} />
                  </button>
                  <button
                    onClick={() => setViewMode('read')}
                    className={`p-1.5 rounded transition-all flex items-center justify-center ${viewMode === 'read' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-400 hover:text-gray-600'}`}
                  >
                    <Eye size={16} />
                  </button>
                </div>

                {/* Formatting Toolbar */}
                {viewMode === 'edit' && (
                  <div className="flex items-center gap-1">
                    <div className="w-px h-5 bg-gray-200 mx-2"></div>
                    <button type="button" onClick={() => insertCharacter('**')} className="w-7 h-7 flex items-center justify-center rounded hover:bg-gray-100 font-bold border border-transparent hover:border-gray-200 text-gray-700 font-serif" title="Esiletõst (Bold)">B</button>
                    <button type="button" onClick={() => insertCharacter('*')} className="w-7 h-7 flex items-center justify-center rounded hover:bg-gray-100 italic font-serif border border-transparent hover:border-gray-200 text-gray-700" title="Kaldkiri (Italic)">I</button>
                    <button type="button" onClick={() => insertCharacter('~')} className="w-7 h-7 flex items-center justify-center rounded hover:bg-gray-100 font-serif border border-transparent hover:border-gray-200 text-gray-700" title="Koodivahetus">𝔉</button>
                    <div className="w-px h-4 bg-gray-300 mx-1"></div>
                    <button type="button" onClick={() => insertCharacter('[[m: ')} className="px-2 h-7 flex items-center justify-center rounded hover:bg-gray-100 text-[11px] text-gray-600 border border-transparent hover:border-gray-200" title="Ääremärkus">Marginalia</button>
                    <button type="button" onClick={() => insertCharacter('[^1]')} className="px-2 h-7 flex items-center justify-center rounded hover:bg-gray-100 text-[11px] text-gray-600 border border-transparent hover:border-gray-200" title="Joonealune märkus">[^1]</button>
                    <button type="button" onClick={() => insertCharacter('--lk--\n')} className="px-2 h-7 flex items-center justify-center rounded hover:bg-gray-100 text-[11px] text-gray-400 border border-transparent hover:border-gray-200 font-mono" title="Lehekülje vahetus">--lk--</button>
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
                    Erimärgid ja juhend
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
                      Ava transkribeerimise juhend
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
                      <h2 className="text-lg font-bold text-gray-800">Transkribeerimise juhend</h2>
                      <button onClick={() => setShowTranscriptionGuide(false)} className="text-gray-500 hover:text-gray-700">
                        <X size={20} />
                      </button>
                    </div>
                    <div
                      className="p-6 overflow-y-auto max-h-[calc(80vh-60px)]"
                      dangerouslySetInnerHTML={{ __html: transcriptionGuideHtml || '<p>Juhendi laadimine...</p>' }}
                    />
                  </div>
                </div>
              )
            }

          </>
        )}

        {/* ANNOTATIONS TAB */}
        {
          activeTab === 'annotate' && (
            <div className="h-full flex flex-col bg-gray-50 p-6 overflow-y-auto">

              {/* Work Info */}
              {work && (
                <div className="bg-white p-5 rounded-lg border border-gray-200 shadow-sm mb-6">
                  <div className="flex items-center gap-2 mb-4 text-gray-800 border-b border-gray-100 pb-2">
                    <BookOpen size={18} className="text-primary-600" />
                    <h4 className="font-bold">{t('info.workInfo')}</h4>
                  </div>
                  <div className="space-y-3 text-sm">
                    <div>
                      <span className="text-gray-500 block text-xs uppercase tracking-wide mb-1">{t('metadata.workTitle')}</span>
                      <p className="text-gray-900 font-medium">{work.title}</p>
                    </div>

                    {/* Isikud: v2 creators[] või fallback v1 author/respondens */}
                    {work.creators && work.creators.length > 0 ? (
                      <div>
                        <span className="text-gray-500 block text-xs uppercase tracking-wide mb-2">{t('metadata.creators')}</span>
                        <div className="space-y-1.5">
                          {work.creators.map((creator, idx) => {
                            const roleLabel = t(`metadata.roles.${creator.role}`, { defaultValue: creator.role });
                            return (
                              <div key={idx} className="flex items-center gap-2">
                                <button
                                  onClick={() => navigate(`/search?q="${encodeURIComponent(creator.name)}"`)}
                                  className="flex items-center gap-1.5 text-gray-900 hover:text-primary-600 transition-colors group"
                                  title={`Otsi "${creator.name}" kõikidest teostest`}
                                >
                                  <User size={14} className="text-gray-400 group-hover:text-primary-500" />
                                  <span className="font-medium">{creator.name}</span>
                                </button>
                                {creator.id && (
                                  <a
                                    href={`https://www.wikidata.org/wiki/${creator.id}`}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="text-gray-400 hover:text-blue-600 p-0.5 rounded-full hover:bg-blue-50 transition-colors"
                                    title={`Vaata Wikidatas: ${creator.id}`}
                                  >
                                    <ExternalLink size={12} />
                                  </a>
                                )}
                                <span className="text-xs text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded">{roleLabel}</span>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    ) : (
                      /* Fallback: v1 author/respondens */
                      <div className="grid grid-cols-2 gap-4">
                        {work.author && (
                          <div>
                            <span className="text-gray-500 block text-xs uppercase tracking-wide mb-1">{t('metadata.author')}</span>
                            <button
                              onClick={() => navigate(`/search?q="${encodeURIComponent(work.author)}"`)}
                              className="flex items-center gap-1.5 text-gray-900 hover:text-primary-600 transition-colors group"
                              title={`Otsi "${work.author}" kõikidest teostest`}
                            >
                              <User size={14} className="text-gray-400 group-hover:text-primary-500" />
                              <span>{work.author}</span>
                            </button>
                          </div>
                        )}
                        {work.respondens && (
                          <div>
                            <span className="text-gray-500 block text-xs uppercase tracking-wide mb-1">{t('metadata.respondens')}</span>
                            <button
                              onClick={() => navigate(`/search?q="${encodeURIComponent(work.respondens)}"`)}
                              className="flex items-center gap-1.5 text-gray-900 hover:text-indigo-600 transition-colors group"
                              title={`Otsi "${work.respondens}" kõikidest teostest`}
                            >
                              <User size={14} className="text-gray-400 group-hover:text-indigo-500" />
                              <span>{work.respondens}</span>
                            </button>
                          </div>
                        )}
                      </div>
                    )}

                    {/* Aasta, Trükikoht, Trükkal, Žanr, Tüüp */}
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <span className="text-gray-500 block text-xs uppercase tracking-wide mb-1">{t('metadata.year')}</span>
                        <p className="text-gray-900">{work.year}</p>
                      </div>
                      
                      {/* Tüüp */}
                      {work.type && (
                        <div>
                          <span className="text-gray-500 block text-xs uppercase tracking-wide mb-1">{t('metadata.type')}</span>
                          <div className="flex items-center gap-1.5">
                            <p className="text-gray-900">{getLabel(work.type_object || work.type, lang)}</p>
                            {work.type_object?.id && (
                              <a
                                href={`https://www.wikidata.org/wiki/${work.type_object.id}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-gray-400 hover:text-blue-600 p-0.5 rounded-full hover:bg-blue-50 transition-colors"
                                title={`Vaata Wikidatas: ${work.type_object.id}`}
                              >
                                <ExternalLink size={12} />
                              </a>
                            )}
                          </div>
                        </div>
                      )}

                      {/* Žanr (üksik) */}
                      {work.genre && (
                        <div>
                          <span className="text-gray-500 block text-xs uppercase tracking-wide mb-1">{t('metadata.genre')}</span>
                          <div className="flex items-center gap-1.5">
                            <p className="text-gray-900">{getLabel(work.genre_object || work.genre, lang)}</p>
                            {(Array.isArray(work.genre_object) ? work.genre_object[0]?.id : work.genre_object?.id) && (
                              <a
                                href={`https://www.wikidata.org/wiki/${Array.isArray(work.genre_object) ? work.genre_object[0].id : work.genre_object?.id}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-gray-400 hover:text-blue-600 p-0.5 rounded-full hover:bg-blue-50 transition-colors"
                                title="Vaata Wikidatas"
                              >
                                <ExternalLink size={12} />
                              </a>
                            )}
                          </div>
                        </div>
                      )}

                      {work.location && (
                        <div>
                          <span className="text-gray-500 block text-xs uppercase tracking-wide mb-1">{t('metadata.place')}</span>
                          <div className="flex items-center gap-1.5">
                            <p className="text-gray-900">{getLabel(work.location, lang)}</p>
                            {work.location_object?.id && (
                              <a
                                href={`https://www.wikidata.org/wiki/${work.location_object.id}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-gray-400 hover:text-blue-600 p-0.5 rounded-full hover:bg-blue-50 transition-colors"
                                title={`Vaata Wikidatas: ${work.location_object.id}`}
                              >
                                <ExternalLink size={12} />
                              </a>
                            )}
                          </div>
                        </div>
                      )}
                      
                      {work.publisher && (
                        <div className="col-span-2 sm:col-span-1">
                          <span className="text-gray-500 block text-xs uppercase tracking-wide mb-1">{t('metadata.printer')}</span>
                          <div className="flex items-center gap-1.5">
                            <button
                              onClick={() => navigate(`/?printer=${encodeURIComponent(getLabel(work.publisher, lang))}`)}
                              className="flex items-center gap-1.5 text-gray-900 hover:text-amber-600 transition-colors group text-left"
                              title="Filtreeri trükkali järgi"
                            >
                              <span className="text-gray-400 group-hover:text-amber-500 font-serif shrink-0">¶</span>
                              <span className="truncate">{getLabel(work.publisher, lang)}</span>
                            </button>
                            {work.publisher_object?.id && (
                              <a
                                href={`https://www.wikidata.org/wiki/${work.publisher_object.id}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-gray-400 hover:text-blue-600 p-0.5 rounded-full hover:bg-blue-50 transition-colors shrink-0"
                                title={`Vaata Wikidatas: ${work.publisher_object.id}`}
                              >
                                <ExternalLink size={12} />
                              </a>
                            )}
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Links and Actions */}
                    <div className="mt-4 pt-3 border-t border-gray-100 space-y-3">
                      {work.ester_id && (
                        <a
                          href={`https://www.ester.ee/record=${work.ester_id}*est`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex items-center gap-2 text-sm text-primary-600 hover:text-primary-800 hover:underline"
                          title="Ava ESTER-i kirje"
                        >
                          <ExternalLink size={16} />
                          {t('info.viewInEster')}
                        </a>
                      )}

                      <button
                        onClick={async () => {
                          try {
                            const { text, title, author, year } = await getWorkFullText(work.id);
                            // Loome faili sisu päisega
                            const header = `${title}\n${author}${year ? `, ${year}` : ''}\n\n`;
                            const fullContent = header + text;
                            // Genereerime faili ja pakume allalaadimiseks
                            const blob = new Blob([fullContent], { type: 'text/plain;charset=utf-8' });
                            const url = URL.createObjectURL(blob);
                            const a = document.createElement('a');
                            a.href = url;
                            a.download = `${work.id}.txt`;
                            document.body.appendChild(a);
                            a.click();
                            document.body.removeChild(a);
                            URL.revokeObjectURL(url);
                          } catch (err) {
                            console.error('Download error:', err);
                            alert('Viga teksti allalaadimisel');
                          }
                        }}
                        className="flex items-center gap-2 text-sm text-primary-600 hover:text-primary-800 hover:underline"
                      >
                        <Download size={16} />
                        {t('metadata.downloadFullText')}
                      </button>

                      {onOpenMetaModal && (
                        <button
                          onClick={onOpenMetaModal}
                          className="flex items-center gap-2 text-sm text-amber-600 hover:text-amber-800 hover:underline"
                          title="Muuda teose metaandmeid"
                        >
                          <Edit3 size={16} />
                          {t('metadata.editMetadata')}
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {/* Genre / Teose märksõnad */}
              {work && ((work.tags && work.tags.length > 0) || (work.tags_object && work.tags_object.length > 0)) && (
                <div className="bg-white p-5 rounded-lg border border-gray-200 shadow-sm mb-6">
                  <div className="flex items-center gap-2 mb-4 text-gray-800 border-b border-gray-100 pb-2">
                    <BookOpen size={18} className="text-green-600" />
                    <h4 className="font-bold">{t('metadata.genre')}</h4>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {(work.tags_object && work.tags_object.length > 0 ? work.tags_object : work.tags).map((tag, idx) => {
                      const label = getLabel(tag, lang);
                      const tagId = typeof tag !== 'string' ? (tag as any).id : null;
                      return (
                        <div key={idx} className="inline-flex items-center bg-green-50 border border-green-100 rounded-full overflow-hidden">
                          <button
                            onClick={() => navigate(`/search?teoseTags=${encodeURIComponent(label)}`)}
                            className="px-2.5 py-1 text-sm text-green-800 hover:bg-green-100 transition-colors flex items-center gap-1"
                            title={`Otsi žanrit: ${label}`}
                          >
                            {label.toLowerCase()}
                            <Search size={12} className="opacity-50" />
                          </button>
                          {tagId && (
                            <a
                              href={`https://www.wikidata.org/wiki/${tagId}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="pr-2 pl-1 py-1 text-green-600 hover:text-green-800 hover:bg-green-100 border-l border-green-100 transition-colors h-full flex items-center"
                              title={`Vaata Wikidatas: ${tagId}`}
                            >
                              <ExternalLink size={10} />
                            </a>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Tags */}
              <div className="bg-white p-5 rounded-lg border border-gray-200 shadow-sm mb-6">
                <div className="flex items-center gap-2 mb-4 text-gray-800 border-b border-gray-100 pb-2">
                  <Tag size={18} className="text-primary-600" />
                  <h4 className="font-bold">{t('workspace:info.pageTags')}</h4>
                </div>
                <div className="flex flex-wrap gap-2 mb-4">
                  {page_tags.length === 0 && <span className="text-sm text-gray-400 italic">Märksõnad puuduvad</span>}
                  {page_tags.map((tag, idx) => {
                    const label = getLabel(tag, lang);
                    const tagId = typeof tag !== 'string' ? (tag as any).id : null;
                    
                    return (
                      <span key={idx} className="inline-flex items-center rounded-full bg-primary-50 border border-primary-100 text-sm text-primary-800 group overflow-hidden">
                        <button
                          onClick={() => navigate(`/search?q=${encodeURIComponent(label)}&scope=annotation`)}
                          className="pl-2.5 pr-1.5 py-1 hover:text-primary-600 flex items-center gap-1"
                          title="Otsi seda märksõna kogu korpusest"
                        >
                          {label.toLowerCase()}
                          <Search size={12} className="opacity-0 group-hover:opacity-50" />
                        </button>
                        
                        {tagId && (
                          <a
                            href={`https://www.wikidata.org/wiki/${tagId}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="px-1.5 py-1 text-primary-400 hover:text-blue-600 border-l border-primary-100 transition-colors"
                            title={`Vaata Wikidatas: ${tagId}`}
                          >
                            <ExternalLink size={10} />
                          </a>
                        )}

                        {!readOnly && (
                          <button 
                            onClick={() => removeTag(typeof tag === 'string' ? tag : (tag as any).label)} 
                            className={`pr-2 pl-1 py-1 text-primary-400 hover:text-red-500 ${tagId ? 'border-l border-primary-100' : ''}`}
                          >
                            <X size={14} />
                          </button>
                        )}
                      </span>
                    );
                  })}
                </div>
                {!readOnly && (
                  <div className="relative">
                    <EntityPicker
                      type="topic"
                      value={null}
                      onChange={(val) => {
                        if (val) {
                          // Lisa märksõna kui teda pole veel listis
                          const label = val.label.toLowerCase();
                          const exists = page_tags.some(t => getLabel(t, lang).toLowerCase() === label);
                          if (!exists) {
                            setPageTags([...page_tags, val]);
                          }
                        }
                      }}
                      placeholder={t('workspace:metadata.tagsPlaceholder')}
                      lang={lang}
                      localSuggestions={tagSuggestions}
                    />
                  </div>
                )}
              </div>

              {/* Comments */}
              <div className="bg-white p-5 rounded-lg border border-gray-200 shadow-sm flex-1 flex flex-col">
                <div className="flex items-center gap-2 mb-4 text-gray-800 border-b border-gray-100 pb-2">
                  <MessageSquare size={18} className="text-primary-600" />
                  <h4 className="font-bold">{t('workspace:info.pageAnnotations')}</h4>
                </div>

                <div className="flex-1 overflow-y-auto space-y-4 mb-4 min-h-[100px]">
                  {comments.length === 0 && (
                    <div className="text-center py-8 text-gray-400">
                      <p className="text-sm italic">{t('info.noAnnotationsHint')}</p>
                    </div>
                  )}
                  {comments.map(comment => (
                    <div key={comment.id} className="bg-gray-50 p-3 rounded-lg border border-gray-100 relative group">
                      <p className="text-gray-800 text-sm mb-2 leading-relaxed pr-5">{comment.text}</p>
                      <div className="flex justify-between items-center text-xs text-gray-500">
                        <span className="font-semibold text-primary-700">{comment.author}</span>
                        <span>{new Date(comment.created_at).toLocaleString('et-EE')}</span>
                      </div>
                      {!readOnly && (
                        <button
                          onClick={() => removeComment(comment.id)}
                          className="absolute top-2 right-2 text-gray-400 hover:text-red-600 opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded hover:bg-white"
                          title="Kustuta kommentaar"
                        >
                          <Trash2 size={14} />
                        </button>
                      )}
                    </div>
                  ))}
                </div>

                {!readOnly ? (
                  <div className="mt-auto">
                    <textarea
                      value={newComment}
                      onChange={(e) => setNewComment(e.target.value)}
                      placeholder={t('info.commentPlaceholder')}
                      className="w-full px-3 py-2 text-sm border border-gray-300 rounded mb-2 focus:border-primary-500 focus:ring-1 focus:ring-primary-200 outline-none resize-none h-24"
                    />
                    <button
                      onClick={addComment}
                      disabled={!newComment.trim()}
                      className="w-full py-2 bg-gray-900 text-white text-xs font-bold uppercase tracking-wider rounded hover:bg-gray-800 disabled:opacity-50 transition-colors"
                    >
                      {t('info.addComment').toUpperCase()}
                    </button>
                  </div>
                ) : (
                  <div className="mt-auto text-center py-4 text-sm text-gray-400">
                    Kommentaaride lisamiseks logi sisse
                  </div>
                )}
              </div>
            </div>
          )
        }

        {/* HISTORY TAB */}
        {
          activeTab === 'history' && (
            <div className="h-full bg-gray-50 p-6 overflow-y-auto">
              {/* Muudatuste ajalugu (Meilisearchist) */}
              <div className="bg-white p-5 rounded-lg border border-gray-200 shadow-sm mb-6">
                <div className="flex items-center gap-2 mb-6 text-gray-800 border-b border-gray-100 pb-2">
                  <History size={18} className="text-primary-600" />
                  <h4 className="font-bold">{t('history.title')}</h4>
                </div>

                <div className="relative border-l-2 border-gray-200 ml-3 space-y-8">
                  {page.history?.map((entry, idx) => (
                    <div key={entry.id} className="relative pl-6">
                      <span className={`absolute -left-[9px] top-1 w-4 h-4 rounded-full border-2 border-white ${entry.action === 'status_change' ? 'bg-blue-500' :
                        entry.action === 'text_edit' ? 'bg-green-500' : 'bg-gray-400'
                        }`}></span>
                      <div className="flex flex-col sm:flex-row sm:justify-between sm:items-baseline mb-1">
                        <span className="text-sm font-bold text-gray-900">{entry.user}</span>
                        <span className="text-xs text-gray-500 font-mono">{new Date(entry.timestamp).toLocaleString('et-EE')}</span>
                      </div>
                      <p className="text-sm text-gray-600">{entry.description}</p>
                      {entry.action === 'status_change' && (
                        <span className="inline-block mt-1 text-xs px-2 py-0.5 bg-blue-50 text-blue-700 rounded border border-blue-100">
                          Staatus muudetud
                        </span>
                      )}
                    </div>
                  ))}
                  {(!page.history || page.history.length === 0) && (
                    <p className="text-sm text-gray-400 pl-6">Ajalugu puudub.</p>
                  )}
                </div>
              </div>

              {/* Git versiooniajalugu (ainult admin näeb) */}
              {user?.role === 'admin' && (
                <div className="bg-white p-5 rounded-lg border border-gray-200 shadow-sm">
                  <div className="flex items-center justify-between mb-4 border-b border-gray-100 pb-2">
                    <div className="flex items-center gap-2 text-gray-800">
                      <RotateCcw size={18} className="text-amber-600" />
                      <h4 className="font-bold">{t('history.gitHistory')}</h4>
                    </div>
                    <button
                      onClick={loadGitHistory}
                      disabled={isLoadingHistory}
                      className="text-xs px-3 py-1 bg-gray-100 hover:bg-gray-200 rounded text-gray-700 transition-colors"
                    >
                      {isLoadingHistory ? t('common:labels.loading') : t('history.refresh')}
                    </button>
                  </div>

                  {gitHistory.length === 0 && !isLoadingHistory && (
                    <p className="text-sm text-gray-400 text-center py-4">{t('history.emptyHistory')}</p>
                  )}

                  {gitHistory.length > 0 && (
                    <div className="space-y-2">
                      {gitHistory.map((entry) => (
                        <div
                          key={entry.full_hash}
                          className={`flex items-center justify-between p-3 rounded-lg border ${entry.is_original
                            ? 'bg-green-50 border-green-200'
                            : 'bg-gray-50 border-gray-200 hover:bg-gray-100'
                            }`}
                        >
                          <div className="flex items-center gap-3 flex-1 min-w-0">
                            {entry.is_original && (
                              <div title="Originaal OCR - esimene versioon">
                                <Shield size={16} className="text-green-600" />
                              </div>
                            )}
                            <div className="min-w-0">
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className="text-sm font-medium text-gray-900">
                                  {entry.formatted_date}
                                </span>
                                <span className="text-xs text-gray-500 font-mono">
                                  {entry.hash}
                                </span>
                                {entry.is_original && (
                                  <span className="text-xs px-2 py-0.5 bg-green-100 text-green-700 rounded">
                                    Originaal OCR
                                  </span>
                                )}
                              </div>
                              <div className="flex items-center gap-1 text-xs text-gray-500 mt-1">
                                <User size={10} />
                                <span>{entry.author}</span>
                              </div>
                            </div>
                          </div>

                          <button
                            onClick={() => handleGitRestore(entry)}
                            disabled={isRestoring || readOnly}
                            className={`text-xs px-3 py-1.5 ${entry.is_original
                              ? 'bg-green-600 hover:bg-green-700'
                              : 'bg-primary-600 hover:bg-primary-700'
                              } disabled:bg-gray-300 text-white rounded transition-colors flex items-center gap-1 shrink-0 ml-2`}
                          >
                            {isRestoring ? (
                              <Loader2 size={12} className="animate-spin" />
                            ) : (
                              <RotateCcw size={12} />
                            )}
                            {entry.is_original ? t('history.original') : t('history.restore')}
                          </button>
                        </div>
                      ))}
                    </div>
                  )}

                  <p className="mt-4 text-xs text-gray-500">
                    <AlertTriangle size={12} className="inline mr-1" />
                    Taastamine laeb valitud versiooni teksti redaktorisse. Muudatuste salvestamiseks vajuta "Salvesta".
                  </p>
                </div>
              )}

              {user && user.role !== 'admin' && (
                <div className="bg-gray-100 p-4 rounded-lg text-center text-sm text-gray-500">
                  Varukoopiate taastamine on saadaval ainult administraatoritele.
                </div>
              )}
            </div>
          )
        }

      </div >
    </div >
  );
};

export default TextEditor;
