import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Page, PageStatus, Annotation, Work } from '../types';
import type { Collections } from '../services/collectionService';
import type { TextAnnotation } from '../types';
import { nextAnnId, containsAnnTag } from '../utils/annUtils';
import { useUser } from '../contexts/UserContext';
import AnnotationsTab from './editor/AnnotationsTab';
import HistoryTab from './editor/HistoryTab';
import EditorStatusBar from './editor/EditorStatusBar';
import EditorToolbar from './editor/EditorToolbar';
import EditorHeader from './editor/EditorHeader';
import ReocrPanel from './editor/ReocrPanel';
import SpecialCharsPanel from './editor/SpecialCharsPanel';
import AnnotationDialog from './editor/AnnotationDialog';
import AnnotationPopover from './editor/AnnotationPopover';
import { vuttMarkupExtension, vuttMarkupField } from './editor/VuttMarkupExtension';
import { marginaliaExtension, marginaliaField, openMarginalia, closeAllMarginalia, hiddenBlockRanges } from './editor/MarginaliaExtension';
import type { MarginaliaMode } from './editor/MarginaliaExtension';
import { cleanMarkupSpecs, marginaliaFromSelection } from '../utils/marginaliaUtils';
import { vuttTheme } from './editor/VuttTheme';
import { fetchWithTimeout } from '../utils/fetchWithTimeout';
import { getLangCode } from '../utils/getLangCode';

// CM6 impordid
import { EditorView, lineNumbers, keymap } from '@codemirror/view';
import { EditorState, EditorSelection, Compartment, Transaction } from '@codemirror/state';
import { history, historyKeymap, defaultKeymap } from '@codemirror/commands';
import { search, searchKeymap, openSearchPanel } from '@codemirror/search';
import { createVuttSearchPanel } from './editor/VuttSearchPanel';
import { findContainer, findInnerPairs } from './editor/wrapTagUtils';
import { useSpecialChars } from './editor/useSpecialChars';
import { useCopyPastePlainMarkup } from './editor/useCopyPastePlainMarkup';
import { useReOcr } from './editor/useReOcr';
import { useEditorState } from './editor/useEditorState';
import { useEditorSave } from './editor/useEditorSave';
import type { EditorTab } from './editor/types';

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
  onWorkUpdate?: (updatedWork: Partial<Work>) => void;
  collections?: Collections;
}

const TextEditor: React.FC<TextEditorProps> = ({ page, work, onSave, onUnsavedChanges, onOpenMetaModal, readOnly = false, statusDirty = false, currentStatus, onStatusChange, triggerSave, onWorkUpdate, collections }) => {
  const { t, i18n } = useTranslation(['workspace', 'common']);
  const { user, authToken, userSettings } = useUser();
  const lang = getLangCode(i18n.language);
  const {
    specialCharacters,
    isCustomChars,
    showCharPanel,
    setShowCharPanel,
    showCharEditor,
    setShowCharEditor,
    setSpecialCharacters,
    setIsCustomChars,
  } = useSpecialChars(authToken);
  const copyPastePlainMarkup = useCopyPastePlainMarkup();
  const [activeTab, setActiveTab] = useState<EditorTab>('edit');
  const hasAppliedDefaultTab = useRef(false);

  // Sünkrooni default_tab serverist (ainult esimesel laadimsel)
  useEffect(() => {
    if (!hasAppliedDefaultTab.current && userSettings.default_tab) {
      setActiveTab(userSettings.default_tab as EditorTab);
      hasAppliedDefaultTab.current = true;
    }
  }, [userSettings.default_tab]);

  const [showTranscriptionGuide, setShowTranscriptionGuide] = useState(false);
  const [transcriptionGuideHtml, setTranscriptionGuideHtml] = useState<string>('');

  const [annDialogOpen, setAnnDialogOpen] = useState(false);
  const [annDialogComment, setAnnDialogComment] = useState('');
  const [annPopover, setAnnPopover] = useState<{ annId: number; x: number; y: number } | null>(null);
  const [annPopoverEditing, setAnnPopoverEditing] = useState(false);
  const [annPopoverEditText, setAnnPopoverEditText] = useState('');
  const [annPopoverPendingDelete, setAnnPopoverPendingDelete] = useState(false);
  const [annDialogError, setAnnDialogError] = useState('');
  const [pendingAnnSelection, setPendingAnnSelection] = useState<{ from: number; to: number; text: string } | null>(null);

  // CM6 refs
  const editorContainerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const editableCompartmentRef = useRef(new Compartment());
  const marginaliaCompartmentRef = useRef(new Compartment());
  const handleSaveRef = useRef<() => void>(() => {});
  // AnnotationsTab registreerib siia kommentaari-mustandi flushi (vt handleSaveWithDrafts)
  const commentFlushRef = useRef<(() => Annotation[] | null) | null>(null);
  const wrapWithTagRef = useRef<(tag: string) => void>(() => {});

  const {
    setIsDirty,
    status,
    comments,
    setComments,
    textAnnotations,
    setTextAnnotations,
    page_tags,
    setPageTags,
    isSaving,
    setIsSaving,
    saveError,
    setSaveError,
    setAnnotationDraftDirty,
    setSavedState,
    hasUnsavedChanges,
  } = useEditorState({ page, viewRef, onUnsavedChanges });

  const annPopoverAnnotationsRef = useRef(textAnnotations);
  useEffect(() => { annPopoverAnnotationsRef.current = textAnnotations; }, [textAnnotations]);

  // Kasutaja eelistus (localStorage) + kitsa paani sundrežiim
  const [marginaliaUserMode, setMarginaliaUserMode] = useState<MarginaliaMode>(
    () => (localStorage.getItem('vutt_marginalia_view') === 'badge' ? 'badge' : 'column')
  );
  const [narrowPane, setNarrowPane] = useState(false);
  // Kitsas paan (kõrvuti aknad) → laiad tekst-sildid kokku ikoonideks.
  // Eraldi (kõrgem) lävend kui narrowPane (640) — sildid kaovad enne badge-režiimi.
  const [compactToolbar, setCompactToolbar] = useState(false);
  const [marginaliaCount, setMarginaliaCount] = useState(0);
  const marginaliaMode: MarginaliaMode = narrowPane ? 'badge' : marginaliaUserMode;

  const { reocrStatus, reocrText, reocrError, handleReOcr, applyReOcr, deleteOcrFile } = useReOcr({
    page,
    authToken,
    viewRef,
    setIsDirty,
  });

  const {
    handleSave,
    handleSaveWithDrafts,
    handleSaveAnnotations,
    handleSaveTextAnnotations: saveTextAnnotations,
    handleDeleteAndSaveTextAnnotation: deleteAndSaveTextAnnotation,
    handleCommentsRestored,
    handleReplyToComment,
  } = useEditorSave({
    page,
    status,
    comments,
    setComments,
    page_tags,
    textAnnotations,
    setTextAnnotations,
    onSave,
    setSavedState,
    setIsDirty,
    setIsSaving,
    setSaveError,
    viewRef,
    commentFlushRef,
    authToken,
  });

  // --- Globaalne Ctrl+F käsitleja — avab CM6 otsingu capture-faasis enne brauserit ---
  useEffect(() => {
    const handleCtrlF = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
        const view = viewRef.current;
        if (view) {
          e.preventDefault();
          e.stopPropagation();
          openSearchPanel(view);
        }
      }
    };
    window.addEventListener('keydown', handleCtrlF, true); // capture=true: enne CM6 ja brauserit
    return () => window.removeEventListener('keydown', handleCtrlF, true);
  }, []);

  // --- CM6 editori loomine (üks kord mount'il) ---
  useEffect(() => {
    if (!editorContainerRef.current) return;

    const view = new EditorView({
      state: EditorState.create({
        doc: page.text_content || '',
        extensions: [
          lineNumbers(),
          history(),
          keymap.of([
            ...defaultKeymap,
            ...historyKeymap,
            ...searchKeymap,
            { key: 'Mod-s', run: () => { handleSaveRef.current(); return true; } },
            { key: 'Mod-b', run: () => { wrapWithTagRef.current('b'); return true; } },
            { key: 'Mod-i', run: () => { wrapWithTagRef.current('i'); return true; } },
            { key: 'Mod-k', run: () => { wrapWithTagRef.current('cs'); return true; } },
          ]),
          editableCompartmentRef.current.of(
            EditorView.editable.of(!readOnly)
          ),
          search({ top: false, createPanel: createVuttSearchPanel }),
          vuttMarkupExtension,
          marginaliaCompartmentRef.current.of(
            marginaliaExtension(localStorage.getItem('vutt_marginalia_view') === 'badge' ? 'badge' : 'column')
          ),
          vuttTheme,
          EditorView.updateListener.of((update) => {
            if (update.docChanged) setIsDirty(true);
            const count = update.state.field(marginaliaField).blocks.length;
            setMarginaliaCount(prev => (prev === count ? prev : count));
          }),
          copyPastePlainMarkup,
        ],
      }),
      parent: editorContainerRef.current,
    });

    viewRef.current = view;
    setMarginaliaCount(view.state.field(marginaliaField).blocks.length);

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

  // Marginaalia režiimi vahetus: reconfigure + sule avatud plokid
  // (facet'i muutus üksi ei käivita dekoratsioonide ümberehitust — closeAll efekt teeb seda)
  useEffect(() => {
    viewRef.current?.dispatch({
      effects: [
        marginaliaCompartmentRef.current.reconfigure(marginaliaExtension(marginaliaMode)),
        closeAllMarginalia.of(null),
      ],
    });
  }, [marginaliaMode]);

  // Kitsas paan sunnib märgivaate — veerg ei mahu.
  // Lävend 500px: veerg ise võtab 146px (.vutt-has-margin padding-left), jättes
  // ~350px tekstile. 640 oli liiga vara — sildid kadusid kuigi ruumi veel jätkus.
  useEffect(() => {
    const el = editorContainerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(entries => {
      const w = entries[0]?.contentRect.width ?? 9999;
      // Peidetud paan (display:none) annab 0-laiuse — ära muuda režiimi
      if (w === 0) return;
      setNarrowPane(w < 500);
      setCompactToolbar(w < 760);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const toggleMarginaliaMode = useCallback(() => {
    setMarginaliaUserMode(prev => {
      const next = prev === 'column' ? 'badge' : 'column';
      localStorage.setItem('vutt_marginalia_view', next);
      return next;
    });
  }, []);

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
  useEffect(() => {
    handleSaveRef.current = handleSave;
    // triggerSave'i kasutab AINULT "Salvesta ja lahku" (Workspace) → flush-variant.
    if (triggerSave) triggerSave.current = handleSaveWithDrafts;
  }, [handleSave, handleSaveWithDrafts, triggerSave]);

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

  // Uus marginaalia: valik tõstetakse <m> plokki valiku algusrea kohale;
  // ilma valikuta tühi <m></m> kursori rea kohale. Mõlemal juhul kohe avatuna.
  const insertMarginalia = useCallback(() => {
    const view = viewRef.current;
    if (!view || readOnly) return;
    let { from, to } = view.state.selection.main;

    if (from === to) {
      const line = view.state.doc.lineAt(from);
      view.dispatch({
        changes: { from: line.from, insert: '<m></m>\n' },
        effects: openMarginalia.of(line.from + 3),
        selection: EditorSelection.cursor(line.from + 3),
        annotations: Transaction.userEvent.of('input.format'),
      });
      view.focus();
      return;
    }

    // Laienda valikut üle poolikute tägide (sama loogika mis cleanMarkup)
    const { tagRanges } = view.state.field(vuttMarkupField);
    for (const r of tagRanges) {
      if (r.from < to && r.to > from) {
        from = Math.min(from, r.from);
        to = Math.max(to, r.to);
      }
    }
    const hidden = hiddenBlockRanges(view.state).filter(h => h.from < to && h.to > from);
    const { changes, cursor } = marginaliaFromSelection(
      view.state.doc.toString(), from, to, hidden,
    );
    view.dispatch({
      changes,
      effects: openMarginalia.of(changes[0].from + 3),
      selection: EditorSelection.cursor(cursor),
      annotations: Transaction.userEvent.of('input.format'),
    });
    view.focus();
  }, [readOnly]);

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

    // Puhasta iga nähtav segment ERALDI muudatusena — peidetud marginaalia
    // plokke ei puudutata üldse, nii jäävad nad oma ridadele ja ankrutele
    // (üks valikut kattev muudatus laseks kaitsefiltril ploki valiku lõppu
    // nihutada, kus ta degradeeruks inline-margiks)
    const hidden = hiddenBlockRanges(view.state).filter(h => h.from < to && h.to > from);
    const specs = cleanMarkupSpecs(
      view.state.doc.toString(), from, to, hidden,
      s => s.replace(/<\/?(?:i|b|cs|m|hi|fn|pb)[^>]*>/g, ''),
    );
    if (specs.length === 0) return;
    const changes = view.state.changes(specs);

    view.dispatch({
      changes,
      selection: EditorSelection.range(changes.mapPos(from, -1), changes.mapPos(to, 1)),
      annotations: Transaction.userEvent.of('input.format'),
    });
    view.focus();
  }, [readOnly]);

  const handleAnnotateSelection = useCallback(() => {
    const view = viewRef.current;
    if (!view) return;
    const { from, to } = view.state.selection.main;
    if (from === to) return;
    const docText = view.state.doc.toString();
    if (containsAnnTag(docText, from, to)) {
      setAnnDialogError(t('editor.annotateOverlapError', 'Valitud tekst sisaldab juba annotatsiooni'));
      setAnnDialogOpen(true);
      setPendingAnnSelection(null);
      return;
    }
    const text = docText.slice(from, to);
    setPendingAnnSelection({ from, to, text });
    setAnnDialogComment('');
    setAnnDialogError('');
    setAnnDialogOpen(true);
  }, [t]);

  useEffect(() => {
    const container = editorContainerRef.current;
    if (!container) return;

    const handleClick = (e: MouseEvent) => {
      const target = (e.target as Element).closest('[data-ann-id]') as HTMLElement | null;
      if (!target) {
        setAnnPopover(null);
        setAnnPopoverEditing(false);
        setAnnPopoverPendingDelete(false);
        return;
      }
      const annId = parseInt(target.getAttribute('data-ann-id') || '', 10);
      if (isNaN(annId)) return;
      e.stopPropagation();
      const rect = target.getBoundingClientRect();
      setAnnPopover({ annId, x: rect.left + rect.width / 2, y: rect.top });
      setAnnPopoverEditing(false);
      setAnnPopoverEditText('');
      setAnnPopoverPendingDelete(false);
    };

    container.addEventListener('click', handleClick);
    return () => container.removeEventListener('click', handleClick);
  }, []); // mount kord — annPopoverAnnotationsRef hoiab annotations ajakohasena

  // Sulge popover klikkimisel väljaspool
  useEffect(() => {
    if (!annPopover) return;
    const handleOutside = () => { setAnnPopover(null); setAnnPopoverEditing(false); setAnnPopoverPendingDelete(false); };
    document.addEventListener('click', handleOutside);
    return () => document.removeEventListener('click', handleOutside);
  }, [annPopover]);

  const insertAnnotation = useCallback((comment: string) => {
    const view = viewRef.current;
    if (!view || !pendingAnnSelection || readOnly) return;
    const annId = nextAnnId(textAnnotations);
    const { from, to, text } = pendingAnnSelection;
    const openTag = `<ann${annId}>`;
    const closeTag = `</ann${annId}>`;

    view.dispatch({
      changes: { from, to, insert: openTag + text + closeTag },
      annotations: [Transaction.userEvent.of('input.format')],
    });

    const newAnnotation: TextAnnotation = {
      id: annId,
      comment,
      author: user?.name || 'Anonüümne',
      created_at: new Date().toISOString(),
    };
    const updated = [...textAnnotations, newAnnotation];
    setTextAnnotations(updated);
    setPendingAnnSelection(null);
    setAnnDialogOpen(false);
    setAnnDialogComment('');
    setAnnDialogError('');
  }, [pendingAnnSelection, textAnnotations, user, readOnly]);

  const removeAnnotationFromEditor = useCallback((annId: number) => {
    const view = viewRef.current;
    if (!view) return;
    const text = view.state.doc.toString();
    const openTag = `<ann${annId}>`;
    const closeTag = `</ann${annId}>`;
    const openIdx = text.indexOf(openTag);
    const closeIdx = text.indexOf(closeTag);
    if (openIdx === -1 || closeIdx === -1) return;
    // Eemalda sulgev täg enne avavat (positsioonid ei nihku)
    const changes = [
      { from: closeIdx, to: closeIdx + closeTag.length, insert: '' },
      { from: openIdx, to: openIdx + openTag.length, insert: '' },
    ].sort((a, b) => b.from - a.from);
    view.dispatch({ changes, annotations: [Transaction.userEvent.of('input.format')] });
  }, []);

  const handleDeleteAndSaveTextAnnotation = useCallback(async (annId: number) => {
    await deleteAndSaveTextAnnotation(annId, removeAnnotationFromEditor);
  }, [deleteAndSaveTextAnnotation, removeAnnotationFromEditor]);

  const handleSaveTextAnnotations = useCallback(async (updatedTextAnnotations: TextAnnotation[]) => {
    await saveTextAnnotations(updatedTextAnnotations);
  }, [saveTextAnnotations]);

  return (
    <>
    <div className="flex flex-col h-full bg-paper font-sans">

      {/* 1. GLOBAL HEADER */}
      <EditorHeader
        work={work}
        activeTab={activeTab}
        readOnly={readOnly}
        isSaving={isSaving}
        hasUnsavedChanges={hasUnsavedChanges}
        statusDirty={statusDirty}
        saveError={saveError}
        onTabChange={setActiveTab}
        onSave={handleSave}
        onClearSaveError={() => setSaveError(null)}
      />

      <div className="flex-1 overflow-hidden relative flex flex-col">

        {/* TEXT TAB CONTENT — alati DOM-is, et CodeMirror ei häviks */}
        <div className={`flex-1 flex flex-col overflow-hidden ${activeTab === 'edit' ? '' : 'hidden'}`}>
            {/* 2. SECONDARY TOOLBAR */}
            <div className="bg-white border-b border-gray-100 flex items-center justify-between px-4 py-1.5 shrink-0 gap-4">

              {/* Editor Tools (Left) */}
              <EditorToolbar
                readOnly={readOnly}
                compactToolbar={compactToolbar}
                narrowPane={narrowPane}
                marginaliaCount={marginaliaCount}
                marginaliaUserMode={marginaliaUserMode}
                wrapWithTag={wrapWithTag}
                insertMarginalia={insertMarginalia}
                insertAtCursor={insertAtCursor}
                cleanMarkup={cleanMarkup}
                onAnnotateSelection={handleAnnotateSelection}
                toggleMarginaliaMode={toggleMarginaliaMode}
              />

              {/* Page Status (Right) */}
              <EditorStatusBar
                status={currentStatus || page.status}
                readOnly={readOnly}
                onStatusChange={onStatusChange}
              />
            </div>

            <ReocrPanel
              variant="banner"
              status={reocrStatus}
              text={reocrText}
              error={reocrError}
              onApply={applyReOcr}
              onDelete={deleteOcrFile}
            />

            {/* 3. EDITOR AREA */}
            <div className="flex-1 relative flex overflow-hidden bg-white">
              <ReocrPanel
                variant="overlay"
                status={reocrStatus}
                text={reocrText}
                error={reocrError}
                onApply={applyReOcr}
                onDelete={deleteOcrFile}
              />
              <div ref={editorContainerRef} className="flex-1 overflow-hidden" />
            </div>

            {/* 4. COLLAPSIBLE FOOTER (erimärkide paneel) — ainult sisselogitud kasutajale */}
            <SpecialCharsPanel
              authToken={authToken}
              user={user}
              readOnly={readOnly}
              specialCharacters={specialCharacters}
              isCustomChars={isCustomChars}
              showCharPanel={showCharPanel}
              showCharEditor={showCharEditor}
              showTranscriptionGuide={showTranscriptionGuide}
              transcriptionGuideHtml={transcriptionGuideHtml}
              setShowCharPanel={setShowCharPanel}
              setShowCharEditor={setShowCharEditor}
              setShowTranscriptionGuide={setShowTranscriptionGuide}
              setSpecialCharacters={setSpecialCharacters}
              setIsCustomChars={setIsCustomChars}
              insertSpecialChar={insertSpecialChar}
            />
        </div>

        {activeTab === 'annotate' && (
          <AnnotationsTab
            work={work}
            page={page}
            page_tags={page_tags}
            setPageTags={setPageTags}
            comments={comments}
            setComments={setComments}
            onDraftChange={setAnnotationDraftDirty}
            flushRef={commentFlushRef}
            onSaveAnnotations={handleSaveAnnotations}
            onCommentsRestored={handleCommentsRestored}
            onReplyToComment={handleReplyToComment}
            readOnly={readOnly || false}
            user={user}
            authToken={authToken}
            onOpenMetaModal={onOpenMetaModal}
            lang={lang}
            textAnnotations={textAnnotations}
            textContent={viewRef.current?.state.doc.toString() ?? page.text_content}
            onSaveTextAnnotations={handleSaveTextAnnotations}
            onDeleteTextAnnotation={handleDeleteAndSaveTextAnnotation}
          />
        )}

        {activeTab === 'history' && (
          <HistoryTab
            page={page}
            work={work}
            user={user}
            authToken={authToken}
            handleReOcr={handleReOcr}
            reocrStatus={reocrStatus}
            onShareableChange={(shareable) => onWorkUpdate?.({ shareable })}
            collections={collections}
            onRestore={(content, restoredTextAnnotations) => {
              const view = viewRef.current;
              if (view) {
                view.dispatch({
                  changes: { from: 0, to: view.state.doc.length, insert: content },
                });
                setIsDirty(true);
              }
              if (Array.isArray(restoredTextAnnotations)) {
                setTextAnnotations(restoredTextAnnotations);
              }
              setActiveTab('edit');
            }}
            readOnly={readOnly || false}
          />
        )}
      </div>
    </div>

    {annPopover && (
      <AnnotationPopover
        annId={annPopover.annId}
        x={annPopover.x}
        y={annPopover.y}
        annotation={annPopoverAnnotationsRef.current.find(a => a.id === annPopover.annId)}
        annotations={annPopoverAnnotationsRef.current}
        readOnly={readOnly}
        editText={annPopoverEditText}
        editing={annPopoverEditing}
        pendingDelete={annPopoverPendingDelete}
        authorName={user?.name || 'Anonüümne'}
        onEditTextChange={setAnnPopoverEditText}
        onEditingChange={setAnnPopoverEditing}
        onPendingDeleteChange={setAnnPopoverPendingDelete}
        onClose={() => setAnnPopover(null)}
        onSaveTextAnnotations={handleSaveTextAnnotations}
        onDeleteTextAnnotation={handleDeleteAndSaveTextAnnotation}
        onRemoveAnchor={removeAnnotationFromEditor}
      />
    )}

    {annDialogOpen && (
      <AnnotationDialog
        comment={annDialogComment}
        error={annDialogError}
        selectionText={pendingAnnSelection?.text}
        onCommentChange={setAnnDialogComment}
        onSave={insertAnnotation}
        onCancel={() => { setAnnDialogOpen(false); setPendingAnnSelection(null); }}
        onCloseError={() => { setAnnDialogOpen(false); setAnnDialogError(''); }}
      />
    )}
    </>
  );
};

export default TextEditor;
