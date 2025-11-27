import React, { useState, useEffect, useRef } from 'react';
import { Page, PageStatus, Annotation, Work } from '../types';
import { Save, Tag, MessageSquare, Loader2, History, FileText, Trash2, Download, X } from 'lucide-react';

interface TextEditorProps {
  page: Page;
  work?: Work;
  onSave: (updatedPage: Page) => Promise<void>;
  onStatusChange: (status: PageStatus) => void;
}

type TabType = 'edit' | 'annotate' | 'history';

const TextEditor: React.FC<TextEditorProps> = ({ page, work, onSave, onStatusChange }) => {
  const [activeTab, setActiveTab] = useState<TabType>('edit');
  
  const [text, setText] = useState(page.text_content);
  const [status, setStatus] = useState(page.status);
  const [comments, setComments] = useState<Annotation[]>(page.comments);
  const [tags, setTags] = useState<string[]>(page.tags);
  const [newTag, setNewTag] = useState('');
  const [newComment, setNewComment] = useState('');
  
  const [isSaving, setIsSaving] = useState(false);

  // Refs for sync scrolling
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const lineNumbersRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setText(page.text_content);
    setStatus(page.status);
    setComments(page.comments);
    setTags(page.tags);
  }, [page]);

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
    } catch (e: any) {
        console.error("Save error:", e);
        alert(`Viga salvestamisel: ${e.message || "Tundmatu viga"}`);
    } finally {
        setIsSaving(false);
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

  const addTag = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && newTag.trim()) {
      e.preventDefault();
      if (!tags.includes(newTag.trim())) {
        setTags([...tags, newTag.trim()]);
      }
      setNewTag('');
    }
  };

  const removeTag = (tagToRemove: string) => {
    setTags(tags.filter(t => t !== tagToRemove));
  };

  const addComment = () => {
    if (!newComment.trim()) return;
    const comment: Annotation = {
      id: Date.now().toString(),
      text: newComment,
      author: 'Mina', 
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
            
            <button 
                onClick={handleSave}
                disabled={isSaving}
                className="flex items-center gap-1.5 px-4 py-1.5 text-sm font-medium text-white bg-primary-600 hover:bg-primary-700 rounded shadow-sm transition-colors disabled:opacity-50"
            >
                {isSaving ? <Loader2 className="animate-spin" size={14} /> : <Save size={14} />}
                {isSaving ? 'Salvestan...' : 'Salvesta'}
            </button>
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
                            onChange={(e) => {
                                setStatus(e.target.value as PageStatus);
                                onStatusChange(e.target.value as PageStatus);
                            }}
                            className={`text-sm font-medium px-2 py-1 rounded border outline-none ${
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
                        className="flex-1 w-full p-6 bg-white outline-none font-serif text-lg leading-relaxed text-gray-800 resize-none whitespace-pre overflow-auto"
                        placeholder="Tekst puudub..."
                        spellCheck={false}
                    />
                </div>
            </div>
        )}

        {/* ANNOTATIONS TAB */}
        {activeTab === 'annotate' && (
            <div className="h-full flex flex-col bg-gray-50 p-6 overflow-y-auto">
                {/* Tags */}
                <div className="bg-white p-5 rounded-lg border border-gray-200 shadow-sm mb-6">
                    <div className="flex items-center gap-2 mb-4 text-gray-800 border-b border-gray-100 pb-2">
                        <Tag size={18} className="text-primary-600" />
                        <h4 className="font-bold">Märksõnad</h4>
                    </div>
                    <div className="flex flex-wrap gap-2 mb-4">
                        {tags.length === 0 && <span className="text-sm text-gray-400 italic">Märksõnad puuduvad</span>}
                        {tags.map(tag => (
                            <span key={tag} className="inline-flex items-center px-2.5 py-1 rounded-full bg-primary-50 border border-primary-100 text-sm text-primary-800">
                                {tag}
                                <button onClick={() => removeTag(tag)} className="ml-1.5 text-primary-400 hover:text-red-500">
                                    <X size={14} />
                                </button>
                            </span>
                        ))}
                    </div>
                    <input
                        type="text"
                        value={newTag}
                        onChange={(e) => setNewTag(e.target.value)}
                        onKeyDown={addTag}
                        placeholder="+ Lisa silt ja vajuta Enter"
                        className="w-full px-3 py-2 text-sm border border-gray-300 rounded focus:border-primary-500 focus:ring-1 focus:ring-primary-200 outline-none transition-shadow"
                    />
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
                                <button 
                                    onClick={() => removeComment(comment.id)}
                                    className="absolute top-2 right-2 text-gray-400 hover:text-red-600 opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded hover:bg-white"
                                    title="Kustuta kommentaar"
                                >
                                    <Trash2 size={14} />
                                </button>
                            </div>
                        ))}
                    </div>

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
                </div>
            </div>
        )}

        {/* HISTORY TAB */}
        {activeTab === 'history' && (
            <div className="h-full bg-gray-50 p-6 overflow-y-auto">
                 <div className="bg-white p-5 rounded-lg border border-gray-200 shadow-sm">
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
                 
                 <div className="mt-6 text-center">
                    <button className="text-sm text-red-600 hover:text-red-800 underline decoration-dotted">
                        Taasta eelmine versioon (Rollback)
                    </button>
                 </div>
            </div>
        )}

      </div>
    </div>
  );
};

export default TextEditor;