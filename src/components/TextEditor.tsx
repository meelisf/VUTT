import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Page, PageStatus, Annotation, Work } from '../types';
import { LinkedEntity } from '../types/LinkedEntity';
import { useUser } from '../contexts/UserContext';
import { Save, Loader2, ChevronRight, X, Settings2, Wand2, Superscript, SeparatorHorizontal } from 'lucide-react';
import AnnotationsTab from './editor/AnnotationsTab';
import HistoryTab from './editor/HistoryTab';
import CharSetEditor from './editor/CharSetEditor';
import { vuttMarkupExtension, vuttMarkupField } from './editor/VuttMarkupExtension';
import { vuttTheme } from './editor/VuttTheme';
import { fetchWithTimeout } from '../utils/fetchWithTimeout';
import { getLangCode } from '../utils/getLangCode';
import { FILE_API_URL } from '../config';

// CM6 impordid
import { EditorView, lineNumbers, keymap } from '@codemirror/view';
import { EditorState, EditorSelection, Compartment, Transaction } from '@codemirror/state';
import { history, historyKeymap, defaultKeymap } from '@codemirror/commands';

// --- wrapWithTag abifunktsioonid ---

interface TagPair {
  open: number; openEnd: number; close: number; closeEnd: number;
}

/**
 * Leiab, kas antud positsioon asub konkreetse tägi vahel.
 * Otsing on piiratud searchFrom ja searchTo vahemikuga (tavaliselt üks rida).
 */
function findContainer(tag: string, pos: number, docText: string, searchFrom = 0, searchTo = docText.length): TagPair | null {
  const openTag = `<${tag}>`;
  const closeTag = `</${tag}>`;
  
  // Leiame viimase avava tägi ENNE positsiooni, aga vahemiku piires
  const lastOpen = docText.lastIndexOf(openTag, pos);
  if (lastOpen === -1 || lastOpen < searchFrom) return null;
  
  // Leiame esimese sulgeva tägi PÄRAST seda avavat tägi
  const firstClose = docText.indexOf(closeTag, lastOpen + openTag.length);
  if (firstClose === -1 || firstClose > searchTo) return null;
  
  const closeEnd = firstClose + closeTag.length;
  // Kontrollime, kas kursor/valik on tõesti selle paari vahel
  if (pos >= lastOpen && pos <= closeEnd) {
    return { open: lastOpen, openEnd: lastOpen + openTag.length, close: firstClose, closeEnd };
  }
  return null;
}

/**
 * Leiab kõik antud tägi paarid vahemikus [from, to].
 */
function findInnerPairs(tag: string, from: number, to: number, docText: string): TagPair[] {
  const openTag = `<${tag}>`;
  const closeTag = `</${tag}>`;
  const pairs: TagPair[] = [];
  let searchFrom = from;
  while (searchFrom < to) {
    const openIdx = docText.indexOf(openTag, searchFrom);
    if (openIdx === -1 || openIdx >= to) break;
    const closeIdx = docText.indexOf(closeTag, openIdx + openTag.length);
    if (closeIdx === -1 || closeIdx > to) break; // Sulgev tägi peab ka jääma vahemikku
    const closeEnd = closeIdx + closeTag.length;
    if (openIdx >= from && closeEnd <= to) {
      pairs.push({ open: openIdx, openEnd: openIdx + openTag.length, close: closeIdx, closeEnd });
    }
    searchFrom = closeEnd;
  }
  return pairs;
}

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
  triggerSave?: React.MutableRefObject<(() => Promise<void>) | null>;
}

type TabType = 'edit' | 'annotate' | 'history';

const TextEditor: React.FC<TextEditorProps> = ({ page, work, onSave, onUnsavedChanges, onOpenMetaModal, readOnly = false, statusDirty = false, currentStatus, onStatusChange, triggerSave }) => {
  const { t, i18n } = useTranslation(['workspace', 'common']);
  const { user, authToken } = useUser();
  const lang = getLangCode(i18n.language);
  const [activeTab, setActiveTab] = useState<TabType>('edit');

  // Redaktori sisu muudatuste jälgimine
  const [isDirty, setIsDirty] = useState(false);
  const [status, setStatus] = useState(page.status);
  const [comments, setComments] = useState<Annotation[]>(page.comments);
  const [page_tags, setPageTags] = useState<(string | LinkedEntity)[]>(page.page_tags || []);
  const [isSaving, setIsSaving] = useState(false);

  // Re-OCR state
  type ReocrStatus = 'idle' | 'uploading' | 'processing' | 'done' | 'error';
  const [reocrStatus, setReocrStatus] = useState<ReocrStatus>('idle');
  const [reocrText, setReocrText] = useState<string | null>(null);
  const [reocrError, setReocrError] = useState<string | null>(null);
  const reocrPollRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Lehekülje failinimi (piltide URL-ist) — kasutatakse .ocr faili ja localStorage võtme jaoks
  const pageFilename = page.image_url ? (page.image_url.split('/').pop() ?? null) : null;
  // localStorage võti poolelioleva re-OCR töö job_id säilitamiseks
  const reocrStorageKey = page.work_id && pageFilename
    ? `reocr_job_${page.work_id}_${pageFilename}`
    : null;
  const didCheckStoredJobRef = useRef(false);

  // Erimärkide state
  const [specialCharacters, setSpecialCharacters] = useState<SpecialCharacter[]>([]);
  const [isCustomChars, setIsCustomChars] = useState(false);
  const [showCharPanel, setShowCharPanel] = useState(true);
  const [showCharEditor, setShowCharEditor] = useState(false);
  const [showTranscriptionGuide, setShowTranscriptionGuide] = useState(false);
  const [transcriptionGuideHtml, setTranscriptionGuideHtml] = useState<string>('');

  // Salvestamata muudatuste jälgimine
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
      const { from, to } = view.state.selection.main;
      if (from === to) return false;
      const selected = view.state.doc.sliceString(from, to);
      const lines = selected.split('\n');
      let result = '';
      for (let i = 0; i < lines.length; i++) {
        if (i === 0) {
          result = lines[i];
        } else if (result.endsWith('-') || result.endsWith('⸗')) {
          result += lines[i];
        } else if (result.endsWith(' ') || lines[i].startsWith(' ')) {
          result += lines[i];
        } else {
          result += ' ' + lines[i];
        }
      }
      const clean = result.replace(/<\/?[a-z]+[^>]*>/g, '').trim();
      event.clipboardData?.setData('text/plain', clean);
      event.preventDefault();
      return true;
    };

    const view = new EditorView({
      state: EditorState.create({
        doc: page.text_content || '',
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
  }, []);

  // Uuendame editeeritavust readOnly muutmisel
  useEffect(() => {
    viewRef.current?.dispatch({
      effects: editableCompartmentRef.current.reconfigure(
        EditorView.editable.of(!readOnly)
      ),
    });
  }, [readOnly]);

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
          changes: { from: 0, to: currentText.length, insert: page.text_content || '' },
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

  // Laadime erimärgid
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

  // Laadime transkribeerimise juhendi
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

  // Annotatsioonide kohene salvestus (möödub state async viivitusest)
  const handleSaveAnnotations = useCallback(async (updatedComments: Annotation[]) => {
    if (isSavingRef.current) return;
    isSavingRef.current = true;
    setIsSaving(true);
    const text = viewRef.current?.state.doc.toString() ?? '';
    const updatedPage: Page = { ...page, text_content: text, status, comments: updatedComments, page_tags };
    try {
      await onSave(updatedPage);
      setSavedState({ status, comments: updatedComments, page_tags });
      setIsDirty(false);
    } catch (e: any) {
      console.error('Save error:', e);
      alert(`Viga salvestamisel: ${e.message || 'Tundmatu viga'}`);
    } finally {
      isSavingRef.current = false;
      setIsSaving(false);
    }
  }, [page, status, page_tags, onSave]);

  useEffect(() => {
    handleSaveRef.current = handleSave;
    if (triggerSave) triggerSave.current = handleSave;
  }, [handleSave, triggerSave]);

  // --- Toolbar toimingud ---
  const wrapWithTag = useCallback((tag: string) => {
    const view = viewRef.current;
    if (!view || readOnly) return;

    const { from, to } = view.state.selection.main;
    const docText = view.state.doc.toString();
    const openTag = `<${tag}>`;
    const closeTag = `</${tag}>`;

    // 1. KÄSITLUS ILMA VALIKUTA (kursor)
    if (from === to) {
      const line = view.state.doc.lineAt(from);
      const container = findContainer(tag, from, docText, line.from, line.to);
      if (container) {
        // Kui kursor on tägi sees, eemaldame tägi
        const changes = [
          { from: container.open, to: container.openEnd, insert: '' },
          { from: container.close, to: container.closeEnd, insert: '' },
        ];
        view.dispatch({
          changes,
          selection: EditorSelection.cursor(view.state.changes(changes).mapPos(from))
        });
      } else {
        // Muul juhul lisame tühjad tägid ja viime kursori vahele
        view.dispatch({
          changes: { from, insert: openTag + closeTag },
          selection: EditorSelection.cursor(from + openTag.length),
        });
      }
      view.focus();
      return;
    }

    // 2. KÄSITLUS VALIKUGA (võib olla mitu rida)
    const lineFrom = view.state.doc.lineAt(from);
    const lineTo = view.state.doc.lineAt(to);
    const changes: { from: number; to: number; insert: string }[] = [];

    // OTSUSTAMINE: Kas me pakime lahti (unwrap) või paneme tägi ümber (wrap)?
    // Reegel: Kui esimese valitud rea sisu on juba tägi sees, siis me pakime LAHTI kõik valitud read.
    let mode: 'wrap' | 'unwrap' = 'wrap';
    for (let i = lineFrom.number; i <= lineTo.number; i++) {
      const line = view.state.doc.line(i);
      let sFrom = Math.max(from, line.from);
      let sTo = Math.min(to, line.to);
      
      // Puhastame servadest tühikud otsuse tegemiseks
      while (sTo > sFrom && /\s/.test(docText[sTo - 1])) sTo--;
      while (sFrom < sTo && /\s/.test(docText[sFrom])) sFrom++;
      
      if (sFrom < sTo) {
        const container = findContainer(tag, sFrom, docText, line.from, line.to);
        if (container && sTo <= container.closeEnd) {
          mode = 'unwrap';
        }
        break; // Võtame esimese sisulise rea järgi otsuse vastu
      }
    }

    // TEGEVUS: Käime read läbi ja rakendame muudatused
    for (let i = lineFrom.number; i <= lineTo.number; i++) {
      const line = view.state.doc.line(i);
      let sFrom = Math.max(from, line.from);
      let sTo = Math.min(to, line.to);

      // Puhastame valiku servadest tühikud/reavahetused
      while (sTo > sFrom && /\s/.test(docText[sTo - 1])) sTo--;
      while (sFrom < sTo && /\s/.test(docText[sFrom])) sFrom++;

      if (sFrom >= sTo) continue; // Tühi rida jääb vahele

      // NUTIKAS PESASTAMINE: Kui mähime stiili-tägiga (i, b, cs), siis 
      // liigume automaatselt struktuuri-tägide (m, hi, fn) SISSE.
      if (mode === 'wrap' && ['i', 'b', 'cs'].includes(tag)) {
        let adjusted = true;
        while (adjusted) {
          adjusted = false;
          // 1. Kontrollime algust: kas sFrom juures algab suvaline täg?
          const startTagMatch = docText.slice(sFrom, sFrom + 20).match(/^<[^>]+>/);
          if (startTagMatch) {
            const tagName = startTagMatch[0].match(/[a-z]+/)?.[0];
            // Kui on struktuuri-täg, hüppame sisse
            if (tagName && ['m', 'hi', 'fn'].includes(tagName)) {
              sFrom += startTagMatch[0].length;
              adjusted = true;
            }
          }

          // 2. Kontrollime lõppu: kas sTo juures lõpeb suvaline täg?
          const endTagMatch = docText.slice(Math.max(0, sTo - 15), sTo).match(/<\/[^>]+>$/);
          if (endTagMatch) {
            const tagName = endTagMatch[0].match(/[a-z]+/)?.[0];
            if (tagName && ['m', 'hi', 'fn'].includes(tagName)) {
              sTo -= endTagMatch[0].length;
              adjusted = true;
            }
          }
          
          if (sFrom >= sTo) break;
        }
      }

      if (mode === 'unwrap') {
        const container = findContainer(tag, sFrom, docText, line.from, line.to);
        if (container && sTo <= container.closeEnd) {
          changes.push({ from: container.open, to: container.openEnd, insert: '' });
          changes.push({ from: container.close, to: container.closeEnd, insert: '' });
        }
      } else {
        // Kui sFrom/sTo asub olemasoleva sama tägi sees, laienda piir tägi alguse/lõpuni
        const startContainer = findContainer(tag, sFrom, docText, line.from, line.to);
        if (startContainer && sFrom > startContainer.open) sFrom = startContainer.open;
        const endContainer = findContainer(tag, sTo, docText, line.from, line.to);
        if (endContainer && sTo < endContainer.closeEnd) sTo = endContainer.closeEnd;

        // WRAP: Eemaldame enne sisemised sama tüüpi tägid, et vältida dubleerimist
        const innerPairs = findInnerPairs(tag, sFrom, sTo, docText);
        // Kui selektsioon algab/lõpeb täpselt olemasoleva tägi piiril, kasuta seda tägina
        // (ära loo uut tägi samale positsioonile — tekitaks konflikti ja pesastuse)
        const leadingPair = innerPairs.length > 0 && innerPairs[0].open === sFrom ? innerPairs[0] : null;
        const trailingPair = innerPairs.length > 0 && innerPairs[innerPairs.length - 1].closeEnd === sTo ? innerPairs[innerPairs.length - 1] : null;
        if (!leadingPair) changes.push({ from: sFrom, to: sFrom, insert: openTag });
        for (const p of innerPairs) {
          if (p === leadingPair) {
            changes.push({ from: p.close, to: p.closeEnd, insert: '' });
          } else if (p === trailingPair) {
            changes.push({ from: p.open, to: p.openEnd, insert: '' });
          } else {
            changes.push({ from: p.open, to: p.openEnd, insert: '' });
            changes.push({ from: p.close, to: p.closeEnd, insert: '' });
          }
        }
        if (!trailingPair) changes.push({ from: sTo, to: sTo, insert: closeTag });
      }
    }

    if (changes.length > 0) {
      const tr = view.state.update({
        changes,
        selection: EditorSelection.range(
          view.state.changes(changes).mapPos(from, 1),
          view.state.changes(changes).mapPos(to, -1)
        ),
        scrollIntoView: false,
        annotations: Transaction.userEvent.of('input.format')
      });
      view.dispatch(tr);
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

  const insertSpecialChar = useCallback((char: string, e?: React.MouseEvent) => {
    if (e) e.preventDefault();
    insertAtCursor(char);
  }, [insertAtCursor]);

  const cleanMarkup = useCallback(() => {
    const view = viewRef.current;
    if (!view || readOnly) return;
    let { from, to } = view.state.selection.main;
    if (from === to) return;

    // Laienda valikut, et hõlmata kõik osaliselt kattuvad tägid
    // (mouse-valik võib lõppeda tägi sees → ilma laienduseta jääb poolik täg alles)
    const { tagRanges } = view.state.field(vuttMarkupField);
    for (const r of tagRanges) {
      if (r.from < to && r.to > from) {
        from = Math.min(from, r.from);
        to = Math.max(to, r.to);
      }
    }

    const selected = view.state.doc.sliceString(from, to);
    // Eemalda kõik VUTT tägid täpse nimeloendi järgi
    const cleaned = selected.replace(/<\/?(?:i|b|cs|m|hi|fn|pb)[^>]*>/g, '');

    view.dispatch({
      changes: { from, to, insert: cleaned },
      selection: EditorSelection.range(from, from + cleaned.length),
      annotations: Transaction.userEvent.of('input.format'),
    });
    view.focus();
  }, [readOnly]);

  useEffect(() => {
    return () => {
      if (reocrPollRef.current) clearTimeout(reocrPollRef.current);
    };
  }, []);

  // Mountimisel: kontrolli esmalt .ocr faili (püsiv), siis localStorage (pooleliolev töö)
  useEffect(() => {
    if (didCheckStoredJobRef.current || !authToken || !page.work_id || !pageFilename) return;
    didCheckStoredJobRef.current = true;

    const startPollingFromSaved = (jobId: string) => {
      setReocrStatus('processing');
      const poll = async () => {
        try {
          const pr = await fetchWithTimeout(
            `${FILE_API_URL}/admin/reocr/${jobId}/status?token=${authToken}`,
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
            if (reocrStorageKey) localStorage.removeItem(reocrStorageKey);
          } else if (pd.status === 'not_found') {
            setReocrStatus('idle');
            if (reocrStorageKey) localStorage.removeItem(reocrStorageKey);
          } else {
            reocrPollRef.current = setTimeout(poll, 3000);
          }
        } catch {
          reocrPollRef.current = setTimeout(poll, 4000);
        }
      };
      reocrPollRef.current = setTimeout(poll, 1000);
    };

    const checkAll = async () => {
      // 1. Kontrolli .ocr faili (elab serverirestate üle)
      try {
        const res = await fetchWithTimeout(
          `${FILE_API_URL}/admin/work/${page.work_id}/page-ocr?filename=${encodeURIComponent(pageFilename)}&token=${authToken}`,
          { timeout: 5000 }
        );
        if (res.ok) {
          const data = await res.json();
          setReocrStatus('done');
          setReocrText(data.text ?? '');
          if (reocrStorageKey) localStorage.removeItem(reocrStorageKey);
          return;
        }
      } catch {
        // Ühenduse viga — proovime localStorage
      }

      // 2. .ocr puudub — kontrolli localStorage (pooleliolev töö)
      const savedJobId = reocrStorageKey ? localStorage.getItem(reocrStorageKey) : null;
      if (!savedJobId) return;

      try {
        const pr = await fetchWithTimeout(
          `${FILE_API_URL}/admin/reocr/${savedJobId}/status?token=${authToken}`,
          { timeout: 10000 }
        );
        const pd = await pr.json();
        if (pd.status === 'done') {
          setReocrStatus('done');
          setReocrText(pd.text ?? '');
        } else if (pd.status === 'uploading' || pd.status === 'processing') {
          startPollingFromSaved(savedJobId);
        } else {
          if (reocrStorageKey) localStorage.removeItem(reocrStorageKey);
        }
      } catch {
        // Eiramine
      }
    };

    checkAll();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authToken]);

  const handleReOcr = useCallback(async () => {
    if (!pageFilename || !authToken) return;

    if (reocrPollRef.current) clearTimeout(reocrPollRef.current);
    setReocrStatus('uploading');
    setReocrText(null);
    setReocrError(null);

    try {
      const res = await fetchWithTimeout(`${FILE_API_URL}/admin/work/${page.work_id}/reocr-page`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ page_filename: pageFilename, page_number: page.page_number, auth_token: authToken }),
        timeout: 30000,
      });
      if (!res.ok) {
        const d = await res.json();
        throw new Error(d.detail || 'Re-OCR alustamine ebaõnnestus');
      }
      const { job_id } = await res.json();
      if (reocrStorageKey) localStorage.setItem(reocrStorageKey, job_id);
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
            if (reocrStorageKey) localStorage.removeItem(reocrStorageKey);
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
  }, [pageFilename, page.work_id, page.page_number, authToken, reocrStorageKey]);

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
    // Kustuta .ocr fail — tulemus on rakendatud
    if (pageFilename && authToken && page.work_id) {
      fetchWithTimeout(
        `${FILE_API_URL}/admin/work/${page.work_id}/page-ocr?filename=${encodeURIComponent(pageFilename)}&token=${authToken}`,
        { method: 'DELETE', timeout: 5000 }
      ).catch(() => {});
    }
    if (reocrStorageKey) localStorage.removeItem(reocrStorageKey);
    setReocrStatus('idle');
    setReocrText(null);
  }, [reocrText, reocrStorageKey, pageFilename, authToken, page.work_id]);

  const deleteOcrFile = useCallback(async () => {
    if (!pageFilename || !authToken || !page.work_id) return;
    await fetchWithTimeout(
      `${FILE_API_URL}/admin/work/${page.work_id}/page-ocr?filename=${encodeURIComponent(pageFilename)}&token=${authToken}`,
      { method: 'DELETE', timeout: 5000 }
    ).catch(() => {});
    if (reocrStorageKey) localStorage.removeItem(reocrStorageKey);
    setReocrStatus('idle');
    setReocrText(null);
  }, [pageFilename, authToken, page.work_id, reocrStorageKey]);

  const dismissReOcr = useCallback(() => {
    if (reocrPollRef.current) clearTimeout(reocrPollRef.current);
    if (reocrStorageKey) localStorage.removeItem(reocrStorageKey);
    setReocrStatus('idle');
    setReocrText(null);
    setReocrError(null);
  }, [reocrStorageKey]);

  const toggleCharPanel = () => setShowCharPanel(!showCharPanel);

  return (
    <div className="flex flex-col h-full bg-paper font-sans">

      {/* 1. GLOBAL HEADER */}
      <div className="bg-white border-b border-gray-200 shrink-0 z-20 shadow-sm">
        {work && (
          <div className="px-4 py-1.5 border-b border-gray-50 flex items-center gap-2 text-[11px] text-gray-500 bg-gray-50/50">
            <span className="font-bold text-gray-700 truncate max-w-[200px]">{work.creators?.find(c => c.role === 'praeses' || c.role === 'auctor')?.name || work.creators?.[0]?.name || ''}</span>
            <span className="text-gray-300">•</span>
            <span className="text-gray-400">{work.year_display || work.year}</span>
            <span className="text-gray-300">•</span>
            <span className="italic truncate flex-1">{work.title}</span>
          </div>
        )}

        <div className="px-4 py-2 flex items-center justify-between gap-4">
          <div className="flex bg-gray-100 p-0.5 rounded-lg shadow-inner">
            <button
              onClick={() => setActiveTab('edit')}
              className={`px-4 py-1.5 text-xs font-bold rounded-md transition-all ${activeTab === 'edit' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
            >
              {(readOnly ? t('tabs.view') : t('tabs.edit')).toUpperCase()}
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

          {!readOnly && (
            <div className="flex items-center gap-2">
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

      <div className="flex-1 overflow-hidden relative flex flex-col">

        {/* TEXT TAB CONTENT — alati DOM-is, et CodeMirror ei häviks */}
        <div className={`flex-1 flex flex-col overflow-hidden ${activeTab === 'edit' ? '' : 'hidden'}`}>
            {/* 2. SECONDARY TOOLBAR */}
            <div className="bg-white border-b border-gray-100 flex items-center justify-between px-4 py-1.5 shrink-0 gap-4">

              {/* Editor Tools (Left) */}
              <div className="flex items-center gap-4 overflow-x-auto no-scrollbar">
                {/* Formatting Toolbar — ainult sisselogitud kasutajale */}
                {!readOnly && (
                  <div className="flex items-center gap-1">
                    <button type="button" onClick={() => wrapWithTag('b')} className="w-7 h-7 flex items-center justify-center rounded hover:bg-gray-100 font-bold border border-transparent hover:border-gray-200 text-gray-700 font-serif" title={`${t('editor.tooltips.bold')} (Ctrl+B)`}>B</button>
                    <button type="button" onClick={() => wrapWithTag('i')} className="w-7 h-7 flex items-center justify-center rounded hover:bg-gray-100 italic font-serif border border-transparent hover:border-gray-200 text-gray-700" title={`${t('editor.tooltips.italic')} (Ctrl+I)`}>I</button>
                    <button type="button" onClick={() => wrapWithTag('cs')} className="w-7 h-7 flex items-center justify-center rounded hover:bg-gray-100 font-serif border border-transparent hover:border-gray-200 text-gray-700" title={`${t('editor.tooltips.fractur')} (Ctrl+K)`}>𝔉</button>
                    <div className="w-px h-4 bg-gray-300 mx-1"></div>
                    <button type="button" onClick={() => wrapWithTag('m')} className="px-2 h-7 flex items-center justify-center rounded hover:bg-gray-100 text-[11px] text-gray-600 border border-transparent hover:border-gray-200" title={t('editor.tooltips.marginalia')}>Marginalia</button>
                    <button type="button" onClick={() => insertAtCursor('<fn>1</fn>')} className="w-7 h-7 flex items-center justify-center rounded hover:bg-gray-100 border border-transparent hover:border-gray-200 text-gray-600" title={t('editor.tooltips.footnote')}><Superscript size={14} /></button>
                    <button type="button" onClick={() => insertAtCursor('<pb/>\n')} className="w-7 h-7 flex items-center justify-center rounded hover:bg-gray-100 border border-transparent hover:border-gray-200 text-gray-400" title={t('editor.tooltips.pageBreak')}><SeparatorHorizontal size={14} /></button>
                    <div className="w-px h-4 bg-gray-300 mx-1"></div>
                    <button type="button" onClick={cleanMarkup} className="px-2 h-7 flex items-center justify-center rounded hover:bg-red-50 text-[11px] text-red-600 border border-transparent hover:border-red-100" title="Puhasta valik märgendusest">Puhasta</button>
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
                    {onStatusChange && !readOnly ? (
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

            {(reocrStatus === 'uploading' || reocrStatus === 'processing') && (
              <div className="shrink-0 bg-emerald-50 border-b border-emerald-200 px-4 py-2 flex items-center gap-2 text-xs text-emerald-800">
                <Loader2 className="animate-spin shrink-0" size={12} />
                {t('editor.reocr.inProgress')}
              </div>
            )}

            {/* 3. EDITOR AREA */}
            <div className="flex-1 relative flex overflow-hidden bg-white">
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
                      <p className="px-4 pt-3 pb-2 text-xs text-gray-500 shrink-0">{t('editor.reocr.modalHint')}</p>
                      <div className="flex-1 overflow-auto px-4 pb-2">
                        <pre className="font-serif text-[15px] leading-[1.7] text-gray-800 whitespace-pre-wrap">{reocrText}</pre>
                      </div>
                      <div className="flex items-center justify-between px-4 py-3 border-t border-gray-200 shrink-0">
                        <button
                          onClick={deleteOcrFile}
                          className="px-3 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50 rounded transition-colors"
                          title={t('editor.reocr.deleteFile')}
                        >
                          {t('editor.reocr.deleteFile')}
                        </button>
                        <div className="flex items-center gap-2">
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
                      </div>
                    </>
                  )}
                </div>
              )}
              <div ref={editorContainerRef} className="flex-1 overflow-hidden" />
            </div>

            {/* 4. COLLAPSIBLE FOOTER (erimärkide paneel) — ainult sisselogitud kasutajale */}
            {!readOnly && (
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
        </div>

        {activeTab === 'annotate' && (
          <AnnotationsTab
            work={work}
            page={page}
            page_tags={page_tags}
            setPageTags={setPageTags}
            comments={comments}
            setComments={setComments}
            onSaveAnnotations={handleSaveAnnotations}
            readOnly={readOnly || false}
            user={user}
            authToken={authToken}
            onOpenMetaModal={onOpenMetaModal}
            lang={lang}
          />
        )}

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
