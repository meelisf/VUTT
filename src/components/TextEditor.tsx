import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Page, PageStatus, Annotation, Work } from '../types';
import type { Collections } from '../services/collectionService';
import type { TextAnnotation } from '../types';
import { nextAnnId, containsAnnTag } from '../utils/annUtils';
import { LinkedEntity } from '../types/LinkedEntity';
import { useUser } from '../contexts/UserContext';
import { Save, Loader2, ChevronRight, X, Settings2, Trash2, Pencil } from 'lucide-react';
import AnnotationsTab from './editor/AnnotationsTab';
import HistoryTab from './editor/HistoryTab';
import CharSetEditor from './editor/CharSetEditor';
import EditorStatusBar from './editor/EditorStatusBar';
import EditorToolbar from './editor/EditorToolbar';
import { vuttMarkupExtension, vuttMarkupField } from './editor/VuttMarkupExtension';
import { marginaliaExtension, marginaliaField, openMarginalia, closeAllMarginalia, hiddenBlockRanges } from './editor/MarginaliaExtension';
import type { MarginaliaMode } from './editor/MarginaliaExtension';
import { cleanMarkupSpecs, marginaliaFromSelection } from '../utils/marginaliaUtils';
import { vuttTheme } from './editor/VuttTheme';
import { fetchWithTimeout } from '../utils/fetchWithTimeout';
import { getLangCode } from '../utils/getLangCode';
import { ErrorBanner } from './ErrorBanner';
import { replyToComment } from '../services/pageService';
import { formatYearDisplay } from '../utils/yearDisplayUtils';

// CM6 impordid
import { EditorView, lineNumbers, keymap } from '@codemirror/view';
import { EditorState, EditorSelection, Compartment, Transaction } from '@codemirror/state';
import { history, historyKeymap, defaultKeymap } from '@codemirror/commands';
import { search, searchKeymap, openSearchPanel } from '@codemirror/search';
import { createVuttSearchPanel } from './editor/VuttSearchPanel';
import { findContainer, findInnerPairs } from './editor/wrapTagUtils';
import { useSpecialChars } from './editor/useSpecialChars';
import { useReOcr } from './editor/useReOcr';
import SafeHtml from './SafeHtml';

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

type TabType = 'edit' | 'annotate' | 'history';

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
  const [activeTab, setActiveTab] = useState<TabType>('edit');
  const hasAppliedDefaultTab = useRef(false);

  // Sünkrooni default_tab serverist (ainult esimesel laadimsel)
  useEffect(() => {
    if (!hasAppliedDefaultTab.current && userSettings.default_tab) {
      setActiveTab(userSettings.default_tab as TabType);
      hasAppliedDefaultTab.current = true;
    }
  }, [userSettings.default_tab]);

  // Redaktori sisu muudatuste jälgimine
  const [isDirty, setIsDirty] = useState(false);
  const [status, setStatus] = useState(page.status);
  const [comments, setComments] = useState<Annotation[]>(page.comments);
  const [textAnnotations, setTextAnnotations] = useState<TextAnnotation[]>(page.text_annotations || []);
  const [page_tags, setPageTags] = useState<(string | LinkedEntity)[]>(page.page_tags || []);
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  // Salvestamata mustand-tekst kommentaaride paanil (AnnotationsTab) — enne nupule vajutust.
  const [annotationDraftDirty, setAnnotationDraftDirty] = useState(false);

  const [showTranscriptionGuide, setShowTranscriptionGuide] = useState(false);
  const [transcriptionGuideHtml, setTranscriptionGuideHtml] = useState<string>('');

  const [annDialogOpen, setAnnDialogOpen] = useState(false);
  const [annDialogComment, setAnnDialogComment] = useState('');
  const [annPopover, setAnnPopover] = useState<{ annId: number; x: number; y: number } | null>(null);
  const [annPopoverEditing, setAnnPopoverEditing] = useState(false);
  const [annPopoverEditText, setAnnPopoverEditText] = useState('');
  const [annPopoverPendingDelete, setAnnPopoverPendingDelete] = useState(false);
  const annPopoverAnnotationsRef = useRef(textAnnotations);
  useEffect(() => { annPopoverAnnotationsRef.current = textAnnotations; }, [textAnnotations]);
  const [annDialogError, setAnnDialogError] = useState('');
  const [pendingAnnSelection, setPendingAnnSelection] = useState<{ from: number; to: number; text: string } | null>(null);

  // Salvestamata muudatuste jälgimine
  const [savedState, setSavedState] = useState({
    status: page.status,
    comments: page.comments,
    page_tags: page.page_tags || [],
    text_annotations: page.text_annotations || [],
  });

  // CM6 refs
  const editorContainerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const editableCompartmentRef = useRef(new Compartment());
  const marginaliaCompartmentRef = useRef(new Compartment());
  const handleSaveRef = useRef<() => void>(() => {});
  // AnnotationsTab registreerib siia kommentaari-mustandi flushi (vt handleSaveWithDrafts)
  const commentFlushRef = useRef<(() => Annotation[] | null) | null>(null);
  const wrapWithTagRef = useRef<(tag: string) => void>(() => {});
  const isSavingRef = useRef(false);

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

  // Arvutame kas on salvestamata muudatusi (shallow compare, mitte JSON.stringify)
  const hasUnsavedChanges = useMemo(() => {
    if (isDirty) return true;
    if (annotationDraftDirty) return true;
    if (status !== savedState.status) return true;
    // page_tags: string/LinkedEntity[] võrdlus sisulise JSON-kuju järgi
    if (JSON.stringify(page_tags) !== JSON.stringify(savedState.page_tags)) return true;
    // comments: Annotation[] shallow compare (id + text + replies)
    if (comments.length !== savedState.comments.length) return true;
    if (comments.some((c, i) => {
      const saved = savedState.comments[i];
      return c.id !== saved?.id || c.text !== saved?.text || JSON.stringify(c.replies || []) !== JSON.stringify(saved.replies || []);
    })) return true;
    if (JSON.stringify(textAnnotations) !== JSON.stringify(savedState.text_annotations)) return true;
    return false;
  }, [isDirty, annotationDraftDirty, status, savedState.status, page_tags, savedState.page_tags, comments, savedState.comments, textAnnotations, savedState.text_annotations]);

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

    // Valiku puhastamine lõikelaua jaoks: VUTT-tägid (<m>, <i> jms) eemaldatud,
    // reavahetused JA poolituskriipsud säilivad täpselt. Ettearvatav plain-tekst.
    const cleanSelectionText = (view: EditorView, from: number, to: number) =>
      view.state.doc.sliceString(from, to).replace(/<\/?[a-z]+[^>]*>/g, '').trim();

    const copyHandler = (event: ClipboardEvent, view: EditorView) => {
      const { from, to } = view.state.selection.main;
      if (from === to) return false;
      event.clipboardData?.setData('text/plain', cleanSelectionText(view, from, to));
      event.preventDefault();
      return true;
    };

    // Lõikamine (Ctrl-X): sama puhastus mis kopeerimisel, AGA peame kustutuse ka
    // ise teostama, sest preventDefault tühistab CM6 vaikimisi lõikamise. Ilma
    // selleta jätaks vaikimisi cut toore teksti (<m> tägid + reavahetused)
    // lõikelauale → paste taasloob osalise marginaalia (vt fix).
    const cutHandler = (event: ClipboardEvent, view: EditorView) => {
      const { from, to } = view.state.selection.main;
      if (from === to) return false;
      event.clipboardData?.setData('text/plain', cleanSelectionText(view, from, to));
      event.preventDefault();
      view.dispatch({
        changes: { from, to, insert: '' },
        selection: { anchor: from },
        userEvent: 'delete.cut',
      });
      return true;
    };

    // Kleepimise kontekst marginaalia suhtes:
    //  'inside'  — kursor olemasoleva <m>…</m> sisus → juba marginaalia, tavaline paste
    //  'wrap'    — tühi/paljas rida AVATUD marginaalia-kasti sees → mähime read <m>-i
    //  'outside' — mujal → tavaline paste
    // "Avatud kasti sees" = paljas rida, mille lähim mittetühi rida (üles või alla,
    // tühje vahele jättes) kuulub avatud <m> ploki ridade hulka. Nii satub ka End+Enter
    // tehtud uus rida (mis tegelikult tekib peidetud </m> taha) õigesse konteksti.
    const pasteMarginaliaContext = (view: EditorView, pos: number): 'inside' | 'wrap' | 'outside' => {
      const { blocks, openMarks } = view.state.field(marginaliaField);
      const openBlocks = blocks.filter(b => openMarks.some(p => p >= b.from && p <= b.to));
      if (openBlocks.length === 0) return 'outside';
      if (blocks.some(b => pos >= b.contentFrom && pos <= b.contentTo)) return 'inside';
      const doc = view.state.doc;
      const lineSpansOpen = (lineNo: number) => openBlocks.some(b =>
        lineNo >= doc.lineAt(b.from).number && lineNo <= doc.lineAt(b.to).number);
      const ln = doc.lineAt(pos).number;
      let up = ln - 1;
      while (up >= 1 && doc.line(up).text.trim() === '') up--;
      if (up >= 1 && lineSpansOpen(up)) return 'wrap';
      let down = ln + 1;
      while (down <= doc.lines && doc.line(down).text.trim() === '') down++;
      if (down <= doc.lines && lineSpansOpen(down)) return 'wrap';
      return 'outside';
    };

    // Kleepimine (Ctrl-V): kui sihtkoht on avatud marginaalia-kast, mähime iga
    // kleebitava rea omaette <m>…</m> plokki (sihtkoht määrab vormingu). Mujal
    // (sh olemasoleva <m> sisus) jätame CM6 vaikekäitumise.
    const pasteHandler = (event: ClipboardEvent, view: EditorView) => {
      const text = event.clipboardData?.getData('text/plain');
      if (!text) return false;
      const { from, to } = view.state.selection.main;
      if (pasteMarginaliaContext(view, from) !== 'wrap') return false;
      const wrapped = text.split('\n')
        .map(line => {
          const s = line.replace(/<\/?[a-z]+[^>]*>/g, '');   // väldi pesastatud <m><m>
          return s.trim() === '' ? '' : `<m>${s}</m>`;
        })
        .join('\n');
      // KRIITILINE: iga <m>…</m> peab jääma OMALE reale. Kui sisestuskoha naabermärk
      // ei ole reavahetus (nt kleepime otse olemasoleva `<m>…` rea ette), siis
      // `<m>X</m><m>Y</m>` satuks ühele reale → kumbki EI ole eraldiseisev plokk →
      // mõlemad renderduksid tavatekstina. Polsterdame reavahetustega.
      const doc = view.state.doc;
      let insert = wrapped;
      const before = from > 0 ? doc.sliceString(from - 1, from) : '\n';
      const after = to < doc.length ? doc.sliceString(to, to + 1) : '\n';
      if (before !== '\n') insert = '\n' + insert;
      if (after !== '\n') insert = insert + '\n';
      view.dispatch({
        changes: { from, to, insert },
        selection: { anchor: from + insert.length },
        userEvent: 'input.paste',
      });
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
          EditorView.domEventHandlers({ copy: copyHandler, cut: cutHandler, paste: pasteHandler }),
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

  // Uuendame editori sisu lehe vahetusel
  useEffect(() => {
    setStatus(page.status);
    setComments(page.comments);
    setTextAnnotations(page.text_annotations || []);
    setPageTags(page.page_tags || []);
    setSavedState({ status: page.status, comments: page.comments, page_tags: page.page_tags || [], text_annotations: page.text_annotations || [] });
    setIsDirty(false);

    const view = viewRef.current;
    if (view) {
      const currentText = view.state.doc.toString();
      if (currentText !== page.text_content) {
        view.dispatch({
          changes: { from: 0, to: currentText.length, insert: page.text_content || '' },
          // Lehevahetusel tühjendame openMarks — vana positsioon kukuks nulli ja
          // avaks võõra ploki uuel lehel
          effects: closeAllMarginalia.of(null),
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
    const updatedPage: Page = { ...page, text_content: text, status, comments, page_tags, text_annotations: textAnnotations };

    try {
      await onSave(updatedPage);
      setSavedState({ status, comments, page_tags, text_annotations: textAnnotations });
      setIsDirty(false);
    } catch (e: any) {
      console.error('Save error:', e);
      setSaveError(t('editor.saveErrorWithMessage', { message: e.message || t('common:errors.unknownError') }));
    } finally {
      isSavingRef.current = false;
      setIsSaving(false);
    }
  }, [page, status, comments, page_tags, textAnnotations, onSave]);

  // Salvestus "Salvesta ja lahku" jaoks: enne salvestust liidab kommentaari-mustandi
  // (uus kommentaar / pooleli muutmine) kommentaaride hulka, et see ei läheks kaduma.
  // Tavaline Salvesta-nupp seda EI tee (mustandi postitamine on "Lisa kommentaar").
  const handleSaveWithDrafts = useCallback(async () => {
    if (isSavingRef.current) return;
    const flushed = commentFlushRef.current?.() ?? null;
    const effectiveComments = flushed ?? comments;
    isSavingRef.current = true;
    setIsSaving(true);
    const text = viewRef.current?.state.doc.toString() ?? '';
    const updatedPage: Page = { ...page, text_content: text, status, comments: effectiveComments, page_tags, text_annotations: textAnnotations };
    try {
      await onSave(updatedPage);
      if (flushed) setComments(flushed);
      setSavedState({ status, comments: effectiveComments, page_tags, text_annotations: textAnnotations });
      setIsDirty(false);
    } catch (e: any) {
      console.error('Save error:', e);
      setSaveError(t('editor.saveErrorWithMessage', { message: e.message || t('common:errors.unknownError') }));
    } finally {
      isSavingRef.current = false;
      setIsSaving(false);
    }
  }, [page, status, comments, page_tags, textAnnotations, onSave, t]);

  // Annotatsioonide kohene salvestus (möödub state async viivitusest)
  const handleSaveAnnotations = useCallback(async (updatedComments: Annotation[]) => {
    if (isSavingRef.current) return;
    isSavingRef.current = true;
    setIsSaving(true);
    const text = viewRef.current?.state.doc.toString() ?? '';
    const updatedPage: Page = { ...page, text_content: text, status, comments: updatedComments, page_tags, text_annotations: textAnnotations };
    try {
      await onSave(updatedPage);
      setSavedState({ status, comments: updatedComments, page_tags, text_annotations: textAnnotations });
      setIsDirty(false);
    } catch (e: any) {
      console.error('Save error:', e);
      setSaveError(t('editor.saveErrorWithMessage', { message: e.message || t('common:errors.unknownError') }));
    } finally {
      isSavingRef.current = false;
      setIsSaving(false);
    }
  }, [page, status, page_tags, textAnnotations, onSave]);

  // Kommentaari taastamine: restore-endpoint on kettale juba committinud, seega
  // sünkroni ainult lokaalne + salvestatud baasseis (mitte teist /save commitit).
  const handleCommentsRestored = useCallback((updatedComments: Annotation[]) => {
    setComments(updatedComments);
    setSavedState({ status, comments: updatedComments, page_tags, text_annotations: textAnnotations });
  }, [status, page_tags, textAnnotations]);

  const handleReplyToComment = useCallback(async (commentId: string, replyText: string) => {
    if (!authToken) {
      throw new Error(t('saveError.tokenMissing'));
    }
    const updatedComments = await replyToComment(page, commentId, replyText, authToken);
    setComments(updatedComments);
    setSavedState({ status, comments: updatedComments, page_tags, text_annotations: textAnnotations });
  }, [authToken, page, status, page_tags, textAnnotations, t]);

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

  const toggleCharPanel = () => setShowCharPanel(!showCharPanel);

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
    // removeAnnotationFromEditor dispatch on CM6-s sünkroonne —
    // pärast seda on viewRef.current.state.doc juba uuendatud (tägid eemaldatud).
    removeAnnotationFromEditor(annId);
    const updated = textAnnotations.filter(a => a.id !== annId);
    setTextAnnotations(updated);
    if (isSavingRef.current) return;
    isSavingRef.current = true;
    setIsSaving(true);
    // Loe tekst PÄRAST dispatch'i — CM6 on juba tägid eemaldanud
    const text = viewRef.current?.state.doc.toString() ?? '';
    const updatedPage: Page = { ...page, text_content: text, status, comments, page_tags, text_annotations: updated };
    try {
      await onSave(updatedPage);
      setSavedState({ status, comments, page_tags, text_annotations: updated });
      setIsDirty(false);
    } catch (e: any) {
      setSaveError(t('editor.saveErrorWithMessage', { message: e.message || t('common:errors.unknownError') }));
    } finally {
      isSavingRef.current = false;
      setIsSaving(false);
    }
  }, [textAnnotations, removeAnnotationFromEditor, page, status, comments, page_tags, onSave]);

  const handleSaveTextAnnotations = useCallback(async (updatedTextAnnotations: TextAnnotation[]) => {
    if (isSavingRef.current) return;
    isSavingRef.current = true;
    setIsSaving(true);
    const text = viewRef.current?.state.doc.toString() ?? '';
    const updatedPage: Page = { ...page, text_content: text, status, comments, page_tags, text_annotations: updatedTextAnnotations };
    try {
      await onSave(updatedPage);
      setTextAnnotations(updatedTextAnnotations);
      setSavedState({ status, comments, page_tags, text_annotations: updatedTextAnnotations });
      setIsDirty(false);
    } catch (e: any) {
      setSaveError(t('editor.saveErrorWithMessage', { message: e.message || t('common:errors.unknownError') }));
    } finally {
      isSavingRef.current = false;
      setIsSaving(false);
    }
  }, [page, status, comments, page_tags, onSave]);

  return (
    <>
    <div className="flex flex-col h-full bg-paper font-sans">

      {/* 1. GLOBAL HEADER */}
      <div className="bg-white border-b border-gray-200 shrink-0 z-20 shadow-sm">
        {work && (
          <div className="px-4 py-1.5 border-b border-gray-50 flex items-center gap-2 text-[11px] text-gray-500 bg-gray-50/50">
            <span className="font-bold text-gray-700 truncate max-w-[200px]">{work.creators?.find(c => c.role === 'praeses' || c.role === 'auctor')?.name || work.creators?.[0]?.name || ''}</span>
            <span className="text-gray-300">•</span>
            <span className="text-gray-400">{formatYearDisplay(work.year_display, work.year, t)}</span>
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
        {saveError && (
          <ErrorBanner
            message={saveError}
            onClose={() => setSaveError(null)}
            className="mx-4 mb-2"
          />
        )}
      </div>

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
                  <div className="px-4 py-3 border-b border-gray-200 shrink-0">
                    <span className="text-sm font-semibold text-gray-800">
                      {reocrStatus === 'error' ? t('editor.reocr.error') : t('editor.reocr.modalTitle')}
                    </span>
                  </div>
                  {reocrStatus === 'error' ? (
                    <div className="flex-1 flex flex-col items-center justify-center p-6 gap-4">
                      <div className="text-sm text-red-600">{reocrError}</div>
                      <button
                        onClick={deleteOcrFile}
                        className="px-4 py-1.5 text-xs font-medium text-white bg-red-600 hover:bg-red-700 rounded transition-colors"
                      >
                        {t('editor.reocr.deleteFile')}
                      </button>
                    </div>
                  ) : (
                    <>
                      <p className="px-4 pt-3 pb-2 text-xs text-gray-500 shrink-0">{t('editor.reocr.modalHint')}</p>
                      <div className="flex-1 overflow-auto px-4 pb-2">
                        <pre className="font-serif text-[15px] leading-[1.7] text-gray-800 whitespace-pre-wrap">{reocrText}</pre>
                      </div>
                      <div className="flex items-center justify-between px-4 py-3 border-t border-gray-200 shrink-0">
                        <button
                          onClick={() => {
                            if (window.confirm(t('editor.reocr.deleteConfirm'))) deleteOcrFile();
                          }}
                          className="px-3 py-1.5 text-xs font-medium text-white bg-red-600 hover:bg-red-700 rounded transition-colors"
                        >
                          {t('editor.reocr.deleteFile')}
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
                  <SafeHtml
                    kind="trusted"
                    html={transcriptionGuideHtml || `<p>${t('common:labels.loading')}...</p>`}
                    className="p-6 overflow-y-auto max-h-[calc(80vh-60px)]"
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

    {annPopover && (() => {
      const ann = annPopoverAnnotationsRef.current.find(a => a.id === annPopover.annId);
      const closePopover = () => { setAnnPopover(null); setAnnPopoverEditing(false); setAnnPopoverPendingDelete(false); };

      // Ühtsed nupustiilid
      const btnCancel = "text-xs text-gray-400 hover:text-gray-700";
      const btnDanger = "text-xs text-red-600 hover:text-red-800 font-medium";
      const btnSave   = "text-xs text-primary-600 hover:text-primary-800 font-medium disabled:opacity-40";

      return (
        <div
          className="fixed z-40 bg-white border border-gray-200 rounded-lg shadow-xl w-72 max-w-xs"
          style={{ left: annPopover.x, top: annPopover.y - 8, transform: 'translate(-50%, -100%)' }}
          onClick={e => e.stopPropagation()}
        >
          {/* Päis: sulge-nupp alati nähtav */}
          <div className="flex items-center justify-between px-3 pt-2.5 pb-1">
            <span className="text-xs font-medium text-gray-500 uppercase tracking-wide">
              {ann ? t('annotations.annotationLabel', 'Märge') : t('annotations.orphanedAnchor', 'Kommentaar puudub')}
            </span>
            <button type="button" onClick={closePopover} className="text-gray-300 hover:text-gray-600 transition-colors" title={t('common:buttons.close', 'Sulge')}>
              <X size={14} />
            </button>
          </div>

          <div className="px-3 pb-3">
            {annPopoverEditing ? (
              /* ── Muutmisvaade (kehtib nii ann kui orphan puhul) ── */
              <div className="space-y-2">
                <textarea
                  autoFocus
                  className="w-full px-2 py-1.5 text-sm border border-primary-300 rounded focus:border-primary-500 focus:ring-1 focus:ring-primary-200 outline-none resize-none"
                  rows={3}
                  placeholder={t('editor.annotateCommentPlaceholder', 'Kommentaar...')}
                  value={annPopoverEditText}
                  onChange={e => setAnnPopoverEditText(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Escape') setAnnPopoverEditing(false);
                    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && annPopoverEditText.trim()) {
                      if (ann) {
                        const updated = annPopoverAnnotationsRef.current.map(a => a.id === ann.id ? { ...a, comment: annPopoverEditText.trim() } : a);
                        handleSaveTextAnnotations(updated);
                      } else {
                        const newAnn: TextAnnotation = { id: annPopover.annId, comment: annPopoverEditText.trim(), author: user?.name || 'Anonüümne', created_at: new Date().toISOString() };
                        handleSaveTextAnnotations([...annPopoverAnnotationsRef.current, newAnn]);
                      }
                      closePopover();
                    }
                  }}
                />
                <div className="flex justify-end gap-3">
                  <button type="button" onClick={() => setAnnPopoverEditing(false)} className={btnCancel}>
                    {t('common:buttons.cancel', 'Tühista')}
                  </button>
                  <button
                    type="button"
                    disabled={!annPopoverEditText.trim()}
                    onClick={() => {
                      if (ann) {
                        const updated = annPopoverAnnotationsRef.current.map(a => a.id === ann.id ? { ...a, comment: annPopoverEditText.trim() } : a);
                        handleSaveTextAnnotations(updated);
                      } else {
                        const newAnn: TextAnnotation = { id: annPopover.annId, comment: annPopoverEditText.trim(), author: user?.name || 'Anonüümne', created_at: new Date().toISOString() };
                        handleSaveTextAnnotations([...annPopoverAnnotationsRef.current, newAnn]);
                      }
                      closePopover();
                    }}
                    className={btnSave}
                  >
                    {t('common:buttons.save', 'Salvesta')}
                  </button>
                </div>
              </div>
            ) : ann ? (
              /* ── Kommentaariga ankur: kuva tekst + tegutsemine ── */
              <>
                <p className="text-sm text-gray-800 mb-2 leading-relaxed whitespace-pre-wrap">{ann.comment}</p>
                <div className="flex items-center justify-between border-t border-gray-100 pt-2">
                  <span className="text-xs text-gray-400">{ann.author}</span>
                  {!readOnly && (
                    <div className="flex gap-3 items-center">
                      {annPopoverPendingDelete ? (
                        <>
                          <button type="button" onClick={() => { handleDeleteAndSaveTextAnnotation(ann.id); closePopover(); }} className={btnDanger}>
                            {t('common:buttons.delete', 'Kustuta')}
                          </button>
                          <button type="button" onClick={() => setAnnPopoverPendingDelete(false)} className={btnCancel}>
                            {t('common:buttons.cancel', 'Tühista')}
                          </button>
                        </>
                      ) : (
                        <>
                          <button type="button" onClick={() => { setAnnPopoverEditing(true); setAnnPopoverEditText(ann.comment); }} className="text-gray-300 hover:text-primary-500 transition-colors" title={t('info.editComment')}>
                            <Pencil size={13} />
                          </button>
                          <button type="button" onClick={() => setAnnPopoverPendingDelete(true)} className="text-gray-300 hover:text-red-500 transition-colors" title={t('info.deleteComment')}>
                            <Trash2 size={13} />
                          </button>
                        </>
                      )}
                    </div>
                  )}
                </div>
              </>
            ) : (
              /* ── Kommentaarita ankur: lisa või kustuta ── */
              !readOnly && (annPopoverPendingDelete ? (
                <div className="flex gap-3 items-center">
                  <button type="button" onClick={() => { removeAnnotationFromEditor(annPopover.annId); closePopover(); }} className={btnDanger}>
                    {t('common:buttons.delete', 'Kustuta')}
                  </button>
                  <button type="button" onClick={() => setAnnPopoverPendingDelete(false)} className={btnCancel}>
                    {t('common:buttons.cancel', 'Tühista')}
                  </button>
                </div>
              ) : (
                <div className="flex items-center justify-between">
                  <button type="button" onClick={() => { setAnnPopoverEditing(true); setAnnPopoverEditText(''); }} className="text-xs text-primary-600 hover:text-primary-800">
                    {t('annotations.addComment', 'Lisa kommentaar')}
                  </button>
                  <button type="button" onClick={() => setAnnPopoverPendingDelete(true)} className="text-gray-300 hover:text-red-500 transition-colors" title={t('annotations.deleteAnchor', 'Kustuta ankur')}>
                    <Trash2 size={13} />
                  </button>
                </div>
              ))
            )}
          </div>
        </div>
      );
    })()}

    {annDialogOpen && (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
        <div className="bg-white rounded-lg shadow-xl p-5 w-96 max-w-full">
          <h3 className="font-bold text-gray-800 mb-1">{t('editor.annotateTitle', 'Lisa kommentaar')}</h3>
          {annDialogError ? (
            <p className="text-sm text-red-600 mb-3">{annDialogError}</p>
          ) : pendingAnnSelection ? (
            <p className="text-xs text-gray-500 mb-3 italic truncate">„{pendingAnnSelection.text}"</p>
          ) : null}
          {!annDialogError && (
            <>
              <textarea
                autoFocus
                className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:ring-2 focus:ring-yellow-400 outline-none resize-none"
                rows={3}
                placeholder={t('editor.annotateCommentPlaceholder', 'Kommentaar...')}
                value={annDialogComment}
                onChange={e => setAnnDialogComment(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && annDialogComment.trim()) {
                    insertAnnotation(annDialogComment.trim());
                  }
                  if (e.key === 'Escape') {
                    setAnnDialogOpen(false);
                    setPendingAnnSelection(null);
                  }
                }}
              />
              <div className="flex justify-end gap-2 mt-3">
                <button
                  type="button"
                  onClick={() => { setAnnDialogOpen(false); setPendingAnnSelection(null); }}
                  className="px-3 py-1.5 text-sm text-gray-600 hover:text-gray-800"
                >{t('common:buttons.cancel', 'Tühista')}</button>
                <button
                  type="button"
                  disabled={!annDialogComment.trim()}
                  onClick={() => { if (annDialogComment.trim()) insertAnnotation(annDialogComment.trim()); }}
                  className="px-3 py-1.5 text-sm bg-yellow-500 hover:bg-yellow-600 text-white rounded disabled:opacity-50"
                >{t('common:buttons.save', 'Salvesta')}</button>
              </div>
            </>
          )}
          {annDialogError && (
            <div className="flex justify-end mt-3">
              <button
                type="button"
                onClick={() => { setAnnDialogOpen(false); setAnnDialogError(''); }}
                className="px-3 py-1.5 text-sm text-gray-600 hover:text-gray-800"
              >{t('common:buttons.close', 'Sulge')}</button>
            </div>
          )}
        </div>
      </div>
    )}
    </>
  );
};

export default TextEditor;
