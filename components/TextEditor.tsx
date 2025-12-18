import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Page, PageStatus, Annotation, Work } from '../types';
import { getAllTags, getWorkFullText } from '../services/meiliService';
import { useUser } from '../contexts/UserContext';
import { FILE_API_URL } from '../config';
import { Save, Tag, MessageSquare, Loader2, History, FileText, Trash2, Download, X, BookOpen, AlertTriangle, Search, RotateCcw, Shield, ExternalLink } from 'lucide-react';

// Varukoopia tüüp
interface BackupEntry {
  filename: string;
  timestamp: string;
  formatted_date: string;
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
  readOnly?: boolean;
}

type TabType = 'edit' | 'annotate' | 'history';

const TextEditor: React.FC<TextEditorProps> = ({ page, work, onSave, onUnsavedChanges, readOnly = false }) => {
  const { user, authToken } = useUser();
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<TabType>('edit');
  
  const [text, setText] = useState(page.text_content);
  const [status, setStatus] = useState(page.status);
  const [comments, setComments] = useState<Annotation[]>(page.comments);
  const [tags, setTags] = useState<string[]>(page.tags);
  const [newTag, setNewTag] = useState('');
  const [newComment, setNewComment] = useState('');
  
  // Autocomplete state
  const [allAvailableTags, setAllAvailableTags] = useState<string[]>([]);
  const [showTagSuggestions, setShowTagSuggestions] = useState(false);
  const [selectedSuggestionIndex, setSelectedSuggestionIndex] = useState(0);
  const tagInputRef = useRef<HTMLInputElement>(null);
  const suggestionsRef = useRef<HTMLDivElement>(null);
  
  const [isSaving, setIsSaving] = useState(false);
  
  // Varukoopiate state
  const [backups, setBackups] = useState<BackupEntry[]>([]);
  const [isLoadingBackups, setIsLoadingBackups] = useState(false);
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
    tags: page.tags
  });

  // Refs for sync scrolling
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const lineNumbersRef = useRef<HTMLDivElement>(null);
  
  // Arvutame kas on salvestamata muudatusi
  const hasUnsavedChanges = 
    text !== savedState.text ||
    status !== savedState.status ||
    JSON.stringify(comments) !== JSON.stringify(savedState.comments) ||
    JSON.stringify(tags) !== JSON.stringify(savedState.tags);

  useEffect(() => {
    setText(page.text_content);
    setStatus(page.status);
    setComments(page.comments);
    setTags(page.tags);
    // Uuendame ka salvestatud olekut uue lehe laadimisel
    setSavedState({
      text: page.text_content,
      status: page.status,
      comments: page.comments,
      tags: page.tags
    });
  }, [page]);

  // Hoiatus brauseri sulgemise/refreshi korral
  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (hasUnsavedChanges) {
        e.preventDefault();
        // Mõned brauserid nõuavad returnValue seadistamist
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

  // Load all available tags for autocomplete
  useEffect(() => {
    const loadTags = async () => {
      const fetchedTags = await getAllTags();
      setAllAvailableTags(fetchedTags);
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
          // Võtame välja nii <style> kui <body> sisu
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

  // Erimärgi sisestamine kursori kohale
  const insertCharacter = useCallback((char: string) => {
    if (!textareaRef.current || readOnly) return;
    
    const textarea = textareaRef.current;
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    
    // Sisestame märgi kursori kohale (või asendame valitud teksti)
    const newText = text.substring(0, start) + char + text.substring(end);
    setText(newText);
    
    // Taastame kursori positsiooni pärast märgi sisestamist
    setTimeout(() => {
      textarea.focus();
      textarea.selectionStart = textarea.selectionEnd = start + char.length;
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
      tags: tags,
    };
    
    try {
        await onSave(updatedPage);
        // Uuendame salvestatud olekut
        setSavedState({
          text: text,
          status: status,
          comments: comments,
          tags: tags
        });
        // Refresh available tags after save to include newly added ones
        const refreshedTags = await getAllTags();
        setAllAvailableTags(refreshedTags);
    } catch (e: any) {
        console.error("Save error:", e);
        alert(`Viga salvestamisel: ${e.message || "Tundmatu viga"}`);
    } finally {
        setIsSaving(false);
    }
  };

  // Varukoopiate laadimine failiserverist
  const loadBackups = async () => {
    if (!page.original_path || !page.image_url) {
      console.warn("Ei saa varukoopiad laadida: puudub original_path või image_url");
      return;
    }

    if (!authToken) {
      alert("Varukoopiate laadimiseks pead olema sisse logitud. Palun logi välja ja uuesti sisse.");
      return;
    }

    setIsLoadingBackups(true);
    try {
      // Tuletame failinime image_url-ist (sama loogika mis savePage's)
      const imagePath = page.image_url.split('/').pop() || '';
      const txtFilename = imagePath.replace(/\.(jpg|jpeg|png|gif)$/i, '.txt');

      const response = await fetch(`${FILE_API_URL}/backups`, {
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
        setBackups(data.backups || []);
      } else {
        console.error("Varukoopiate laadimine ebaõnnestus:", data.message);
        if (data.message?.includes('Autentimine') || data.message?.includes('parool')) {
          alert("Autentimine ebaõnnestus. Palun logi välja ja uuesti sisse.");
        }
      }
    } catch (e) {
      console.error("Varukoopiate laadimine ebaõnnestus:", e);
    } finally {
      setIsLoadingBackups(false);
    }
  };

  // Varukoopia taastamine (laeb teksti editorisse, kasutaja peab salvestama)
  const handleRestore = async (backup: BackupEntry) => {
    if (!page.original_path || !page.image_url) {
      alert("Taastamine ebaõnnestus: puudub vajalik info");
      return;
    }

    if (!authToken) {
      alert("Taastamiseks pead olema sisse logitud. Palun logi välja ja uuesti sisse.");
      return;
    }

    if (!confirm(`Kas soovid taastada versiooni ${backup.formatted_date}?\n\nTekst laaditakse redaktorisse. Muudatuste salvestamiseks pead vajutama "Salvesta".`)) {
      return;
    }

    setIsRestoring(true);
    try {
      const imagePath = page.image_url.split('/').pop() || '';
      const txtFilename = imagePath.replace(/\.(jpg|jpeg|png|gif)$/i, '.txt');

      const response = await fetch(`${FILE_API_URL}/restore`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          original_path: page.original_path,
          file_name: txtFilename,
          backup_filename: backup.filename,
          auth_token: authToken
        })
      });

      const data = await response.json();
      if (data.status === 'success' && data.restored_content !== undefined) {
        // Laeme taastatud teksti editorisse
        setText(data.restored_content);
        // Lülitume "Redigeeri" vaatesse, et kasutaja näeks muutust
        setActiveTab('edit');
        alert(`Versioon ${backup.formatted_date} laaditud redaktorisse.\n\nSalvestamiseks vajuta "Salvesta" nuppu.`);
        // Värskendame varukoopiate loendit
        loadBackups();
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
        // Üritame pildi fetchida, et saaks määrata failinime
        const response = await fetch(page.image_url);
        if(!response.ok) throw new Error("Fetch failed");
        
        const blob = await response.blob();
        const url = window.URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        // Tuletame failinime URL-ist või kasutame vaikimisi nime
        const filename = page.image_url.split('/').pop() || `lk_${page.page_number}.jpg`;
        link.download = filename;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        window.URL.revokeObjectURL(url);
    } catch (e) {
        console.warn("Otse allalaadimine ebaõnnestus (CORS?), avan uuel vahelehel.", e);
        // Fallback: kui otse allalaadimine ei õnnestu (nt CORS tõttu), avame uues aknas
        window.open(page.image_url, '_blank');
    }
  };

  // Filter suggestions based on input
  const filteredSuggestions = allAvailableTags.filter(
    tag => tag.toLowerCase().includes(newTag.toLowerCase()) && !tags.includes(tag)
  );

  const addTagFromInput = (tagValue: string) => {
    const trimmed = tagValue.trim();
    if (trimmed && !tags.includes(trimmed)) {
      setTags([...tags, trimmed]);
      // Also add to available tags locally so it appears in suggestions immediately
      if (!allAvailableTags.includes(trimmed)) {
        setAllAvailableTags(prev => [...prev, trimmed].sort((a, b) => a.localeCompare(b, 'et')));
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
    setTags(tags.filter(t => t !== tagToRemove));
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

  // Synchronize scrolling between textarea and line numbers
  const handleScroll = () => {
    if (textareaRef.current && lineNumbersRef.current) {
      lineNumbersRef.current.scrollTop = textareaRef.current.scrollTop;
    }
  };

  // Generate line numbers based on text content
  const lineCount = text.split('\n').length;
  const lineNumbers = Array.from({ length: Math.max(1, lineCount) }, (_, i) => i + 1);

  return (
    <div className="flex flex-col h-full bg-paper font-sans">
      
      {/* Header / Meta Info */}
      <div className="bg-white border-b border-gray-200 px-4 py-3">
        {work && (
            <div className="mb-2 text-xs text-gray-500 flex items-center gap-2">
                <span className="font-bold text-gray-800 truncate max-w-[200px]">{work.author}</span>
                <span>•</span>
                <span>{work.year}</span>
                <span>•</span>
                <span className="truncate max-w-[150px]">{work.title}</span>
            </div>
        )}
        <div className="flex items-center justify-between">
            <div className="flex gap-1">
                <button 
                    onClick={() => setActiveTab('edit')}
                    className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors flex items-center gap-2 ${activeTab === 'edit' ? 'bg-primary-50 text-primary-700' : 'text-gray-600 hover:bg-gray-100'}`}
                >
                    <FileText size={16}/> Tekst
                </button>
                <button 
                    onClick={() => setActiveTab('annotate')}
                    className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors flex items-center gap-2 ${activeTab === 'annotate' ? 'bg-primary-50 text-primary-700' : 'text-gray-600 hover:bg-gray-100'}`}
                >
                    <MessageSquare size={16}/> Info & Annotatsioonid
                </button>
                <button 
                    onClick={() => setActiveTab('history')}
                    className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors flex items-center gap-2 ${activeTab === 'history' ? 'bg-primary-50 text-primary-700' : 'text-gray-600 hover:bg-gray-100'}`}
                >
                    <History size={16}/> Ajalugu
                </button>
            </div>
            
            <div className="flex items-center gap-3">
              {readOnly && (
                <span className="text-xs text-gray-500 flex items-center gap-1 bg-gray-100 px-2 py-1 rounded">
                  Ainult lugemiseks
                </span>
              )}
              {hasUnsavedChanges && !readOnly && (
                <span className="text-xs text-amber-600 flex items-center gap-1">
                  <AlertTriangle size={14} />
                  Salvestamata muudatused
                </span>
              )}
              <button 
                  onClick={handleSave}
                  disabled={isSaving || readOnly}
                  className={`flex items-center gap-1.5 px-4 py-1.5 text-sm font-medium text-white rounded shadow-sm transition-colors disabled:opacity-50 ${
                    hasUnsavedChanges && !readOnly
                      ? 'bg-amber-500 hover:bg-amber-600' 
                      : 'bg-primary-600 hover:bg-primary-700'
                  }`}
                  title={readOnly ? 'Salvestamiseks logi sisse' : ''}
              >
                  {isSaving ? <Loader2 className="animate-spin" size={14} /> : <Save size={14} />}
                  {isSaving ? 'Salvestan...' : 'Salvesta'}
              </button>
            </div>
        </div>
      </div>

      {/* Main Content Area */}
      <div className="flex-1 overflow-hidden relative">
        
        {/* EDIT TAB */}
        {activeTab === 'edit' && (
            <div className="h-full flex flex-col p-6 overflow-hidden">
                <div className="flex justify-between items-center mb-4 shrink-0">
                     <div className="flex items-center gap-2">
                        <span className="text-xs font-semibold text-gray-500 uppercase">Staatus:</span>
                        <select 
                            value={status}
                            onChange={(e) => setStatus(e.target.value as PageStatus)}
                            disabled={readOnly}
                            className={`text-sm font-medium px-2 py-1 rounded border outline-none disabled:cursor-not-allowed ${
                                status === PageStatus.DONE ? 'bg-green-50 text-green-700 border-green-200' :
                                status === PageStatus.CORRECTED ? 'bg-blue-50 text-blue-700 border-blue-200' :
                                'bg-gray-50 text-gray-700 border-gray-200'
                            }`}
                        >
                            {Object.values(PageStatus).map((s) => (
                                <option key={s} value={s}>{s}</option>
                            ))}
                        </select>
                    </div>
                    <button 
                        onClick={handleDownloadImage}
                        className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold uppercase tracking-wider text-gray-700 bg-white hover:bg-gray-50 rounded border border-gray-300 shadow-sm transition-colors"
                        title="Lae pilt alla (et kasutada seda välises tööriistas)"
                    >
                        <Download size={12} />
                        Lae alla pilt
                    </button>
                </div>

                {/* Editor Container with Line Numbers */}
                <div className="flex-1 relative flex border border-gray-200 rounded-lg overflow-hidden bg-white shadow-sm">
                    {/* Line Numbers Column */}
                    <div 
                        ref={lineNumbersRef}
                        className="w-12 bg-gray-50 border-r border-gray-200 text-gray-400 font-serif text-lg leading-relaxed text-right py-6 pr-2 select-none overflow-hidden"
                    >
                        {lineNumbers.map((num) => (
                            <div key={num} className="whitespace-no-wrap">{num}</div>
                        ))}
                    </div>

                    {/* Text Area */}
                    <textarea
                        ref={textareaRef}
                        value={text}
                        onChange={(e) => setText(e.target.value)}
                        onScroll={handleScroll}
                        readOnly={readOnly}
                        className={`flex-1 w-full p-6 bg-white outline-none font-serif text-lg leading-relaxed text-gray-800 resize-none whitespace-pre overflow-auto ${readOnly ? 'cursor-default' : ''}`}
                        placeholder="Tekst puudub..."
                        spellCheck={false}
                    />
                </div>

                {/* Erimärkide paneel */}
                {specialCharacters.length > 0 && (
                  <div className="mt-3 shrink-0">
                    <div className="flex items-center gap-3 mb-2">
                      <button
                        onClick={() => setShowCharPanel(!showCharPanel)}
                        className="text-xs text-gray-500 hover:text-gray-700 flex items-center gap-1"
                      >
                        {showCharPanel ? '▼' : '▶'} Erimärgid
                      </button>
                      <span className="text-gray-300">|</span>
                      <button
                        onClick={() => setShowTranscriptionGuide(true)}
                        className="text-xs text-primary-600 hover:text-primary-800 hover:underline"
                      >
                        Transkribeerimise juhend
                      </button>
                    </div>
                    {showCharPanel && (
                      <div className="flex flex-wrap gap-1 p-2 bg-gray-50 border border-gray-200 rounded-lg">
                        {/* Grupeerime read */}
                        {Array.from(new Set(specialCharacters.map(c => c.row))).sort().map(row => (
                          <div key={row} className="flex gap-1 mr-3">
                            {specialCharacters
                              .filter(c => c.row === row)
                              .map((char, idx) => (
                                <button
                                  key={`${row}-${idx}`}
                                  onClick={() => insertCharacter(char.character)}
                                  disabled={readOnly}
                                  title={char.name || char.character}
                                  className="w-8 h-8 flex items-center justify-center text-lg font-serif bg-white border border-gray-300 rounded hover:bg-primary-50 hover:border-primary-300 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                                >
                                  {char.character}
                                </button>
                              ))}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {/* Transkribeerimise juhendi modaal */}
                {showTranscriptionGuide && (
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
                )}
            </div>
        )}

        {/* ANNOTATIONS TAB */}
        {activeTab === 'annotate' && (
            <div className="h-full flex flex-col bg-gray-50 p-6 overflow-y-auto">
                
                {/* Work Info */}
                {work && (
                  <div className="bg-white p-5 rounded-lg border border-gray-200 shadow-sm mb-6">
                    <div className="flex items-center gap-2 mb-4 text-gray-800 border-b border-gray-100 pb-2">
                        <BookOpen size={18} className="text-primary-600" />
                        <h4 className="font-bold">Teose andmed</h4>
                    </div>
                    <div className="space-y-3 text-sm">
                      <div>
                        <span className="text-gray-500 block text-xs uppercase tracking-wide mb-1">Pealkiri</span>
                        <p className="text-gray-900 font-medium">{work.title}</p>
                      </div>
                      <div className="flex gap-6">
                        <div className="flex-1">
                          <span className="text-gray-500 block text-xs uppercase tracking-wide mb-1">Autor</span>
                          <p className="text-gray-900">{work.author}</p>
                        </div>
                        {work.respondens && (
                          <div className="flex-1">
                            <span className="text-gray-500 block text-xs uppercase tracking-wide mb-1">Respondens</span>
                            <p className="text-gray-900">{work.respondens}</p>
                          </div>
                        )}
                        <div>
                          <span className="text-gray-500 block text-xs uppercase tracking-wide mb-1">Aasta</span>
                          <p className="text-gray-900">{work.year}</p>
                        </div>
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
                             Vaata ESTER-is
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
                          Lae alla kogu teose tekst
                        </button>
                      </div>
                    </div>
                  </div>
                )}

                {/* Tags */}
                <div className="bg-white p-5 rounded-lg border border-gray-200 shadow-sm mb-6">
                    <div className="flex items-center gap-2 mb-4 text-gray-800 border-b border-gray-100 pb-2">
                        <Tag size={18} className="text-primary-600" />
                        <h4 className="font-bold">Märksõnad</h4>
                    </div>
                    <div className="flex flex-wrap gap-2 mb-4">
                        {tags.length === 0 && <span className="text-sm text-gray-400 italic">Märksõnad puuduvad</span>}
                        {tags.map(tag => (
                            <span key={tag} className="inline-flex items-center px-2.5 py-1 rounded-full bg-primary-50 border border-primary-100 text-sm text-primary-800 group">
                                <button 
                                    onClick={() => navigate(`/search?q=${encodeURIComponent(tag)}&scope=annotation`)}
                                    className="hover:text-primary-600 hover:underline flex items-center gap-1"
                                    title="Otsi seda märksõna kogu korpusest"
                                >
                                    {tag}
                                    <Search size={12} className="opacity-0 group-hover:opacity-50" />
                                </button>
                                {!readOnly && (
                                  <button onClick={() => removeTag(tag)} className="ml-1.5 text-primary-400 hover:text-red-500">
                                      <X size={14} />
                                  </button>
                                )}
                            </span>
                        ))}
                    </div>
                    {!readOnly && (
                      <div className="relative">
                        <input
                            ref={tagInputRef}
                            type="text"
                            value={newTag}
                            onChange={(e) => handleTagInputChange(e.target.value)}
                            onKeyDown={handleTagKeyDown}
                            onFocus={() => newTag.length > 0 && setShowTagSuggestions(true)}
                            placeholder="+ Lisa märksõna..."
                            className="w-full px-3 py-2 text-sm border border-gray-300 rounded focus:border-primary-500 focus:ring-1 focus:ring-primary-200 outline-none transition-shadow"
                        />
                        {/* Autocomplete dropdown */}
                        {showTagSuggestions && filteredSuggestions.length > 0 && (
                          <div 
                            ref={suggestionsRef}
                            className="absolute z-10 w-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg max-h-48 overflow-y-auto"
                          >
                            {filteredSuggestions.slice(0, 10).map((suggestion, idx) => (
                              <button
                                key={suggestion}
                                type="button"
                                onClick={() => addTagFromInput(suggestion)}
                                className={`w-full text-left px-3 py-2 text-sm transition-colors ${
                                  idx === selectedSuggestionIndex 
                                    ? 'bg-primary-50 text-primary-700' 
                                    : 'text-gray-700 hover:bg-gray-50'
                                }`}
                              >
                                {suggestion}
                              </button>
                            ))}
                          </div>
                        )}
                        {showTagSuggestions && newTag.length > 0 && filteredSuggestions.length === 0 && (
                          <div className="absolute z-10 w-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg p-3 text-sm text-gray-500">
                            Vajuta Enter, et lisada uus märksõna: <strong className="text-primary-600">{newTag}</strong>
                          </div>
                        )}
                      </div>
                    )}
                </div>

                {/* Comments */}
                <div className="bg-white p-5 rounded-lg border border-gray-200 shadow-sm flex-1 flex flex-col">
                    <div className="flex items-center gap-2 mb-4 text-gray-800 border-b border-gray-100 pb-2">
                        <MessageSquare size={18} className="text-primary-600" />
                        <h4 className="font-bold">Kommentaarid</h4>
                    </div>
                    
                    <div className="flex-1 overflow-y-auto space-y-4 mb-4 min-h-[100px]">
                        {comments.length === 0 && (
                            <div className="text-center py-8 text-gray-400">
                                <p className="text-sm italic">Lisa esimene kommentaar või märkus.</p>
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
                              placeholder="Kirjuta siia..."
                              className="w-full px-3 py-2 text-sm border border-gray-300 rounded mb-2 focus:border-primary-500 focus:ring-1 focus:ring-primary-200 outline-none resize-none h-24"
                          />
                          <button 
                              onClick={addComment}
                              disabled={!newComment.trim()}
                              className="w-full py-2 bg-gray-900 text-white text-xs font-bold uppercase tracking-wider rounded hover:bg-gray-800 disabled:opacity-50 transition-colors"
                          >
                              Lisa Kommentaar
                          </button>
                      </div>
                    ) : (
                      <div className="mt-auto text-center py-4 text-sm text-gray-400">
                        Kommentaaride lisamiseks logi sisse
                      </div>
                    )}
                </div>
            </div>
        )}

        {/* HISTORY TAB */}
        {activeTab === 'history' && (
            <div className="h-full bg-gray-50 p-6 overflow-y-auto">
                 {/* Muudatuste ajalugu (Meilisearchist) */}
                 <div className="bg-white p-5 rounded-lg border border-gray-200 shadow-sm mb-6">
                    <div className="flex items-center gap-2 mb-6 text-gray-800 border-b border-gray-100 pb-2">
                        <History size={18} className="text-primary-600" />
                        <h4 className="font-bold">Muudatuste ajalugu</h4>
                    </div>

                    <div className="relative border-l-2 border-gray-200 ml-3 space-y-8">
                        {page.history?.map((entry, idx) => (
                            <div key={entry.id} className="relative pl-6">
                                <span className={`absolute -left-[9px] top-1 w-4 h-4 rounded-full border-2 border-white ${
                                    entry.action === 'status_change' ? 'bg-blue-500' : 
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
                 
                 {/* Varukoopiad failisüsteemist (ainult admin näeb) */}
                 {user?.role === 'admin' && (
                   <div className="bg-white p-5 rounded-lg border border-gray-200 shadow-sm">
                      <div className="flex items-center justify-between mb-4 border-b border-gray-100 pb-2">
                        <div className="flex items-center gap-2 text-gray-800">
                          <RotateCcw size={18} className="text-amber-600" />
                          <h4 className="font-bold">Varukoopiad</h4>
                        </div>
                        <button
                          onClick={loadBackups}
                          disabled={isLoadingBackups}
                          className="text-xs px-3 py-1 bg-gray-100 hover:bg-gray-200 rounded text-gray-700 transition-colors"
                        >
                          {isLoadingBackups ? 'Laadin...' : 'Värskenda'}
                        </button>
                      </div>
                      
                      {backups.length === 0 && !isLoadingBackups && (
                        <p className="text-sm text-gray-400 text-center py-4">Varukoopiad puuduvad või vajuta "Värskenda"</p>
                      )}
                      
                      {backups.length > 0 && (
                        <div className="space-y-2">
                          {backups.map((backup, idx) => (
                            <div 
                              key={backup.filename} 
                              className={`flex items-center justify-between p-3 rounded-lg border ${
                                backup.is_original 
                                  ? 'bg-amber-50 border-amber-200' 
                                  : 'bg-gray-50 border-gray-200 hover:bg-gray-100'
                              }`}
                            >
                              <div className="flex items-center gap-3">
                                {backup.is_original && (
                                  <Shield size={16} className="text-amber-600" title="Originaal - kaitstud" />
                                )}
                                <div>
                                  <span className="text-sm font-medium text-gray-900">
                                    {backup.formatted_date}
                                  </span>
                                  {backup.is_original && (
                                    <span className="ml-2 text-xs px-2 py-0.5 bg-amber-100 text-amber-700 rounded">
                                      Originaal
                                    </span>
                                  )}
                                </div>
                              </div>
                              
                              {!backup.is_original ? (
                                <button
                                  onClick={() => handleRestore(backup)}
                                  disabled={isRestoring || readOnly}
                                  className="text-xs px-3 py-1.5 bg-primary-600 hover:bg-primary-700 disabled:bg-gray-300 text-white rounded transition-colors flex items-center gap-1"
                                >
                                  {isRestoring ? (
                                    <Loader2 size={12} className="animate-spin" />
                                  ) : (
                                    <RotateCcw size={12} />
                                  )}
                                  Taasta
                                </button>
                              ) : (
                                <button
                                  onClick={() => handleRestore(backup)}
                                  disabled={isRestoring || readOnly}
                                  className="text-xs px-3 py-1.5 bg-amber-600 hover:bg-amber-700 disabled:bg-gray-300 text-white rounded transition-colors flex items-center gap-1"
                                >
                                  {isRestoring ? (
                                    <Loader2 size={12} className="animate-spin" />
                                  ) : (
                                    <RotateCcw size={12} />
                                  )}
                                  Taasta originaal
                                </button>
                              )}
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
        )}

      </div>
    </div>
  );
};

export default TextEditor;
