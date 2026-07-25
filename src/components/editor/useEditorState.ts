import { useEffect, useMemo, useRef, useState, type MutableRefObject } from 'react';
import type { EditorView } from '@codemirror/view';
import type { Annotation, Page, TextAnnotation } from '../../types';
import type { LinkedEntity } from '../../types/LinkedEntity';
import { closeAllMarginalia } from './MarginaliaExtension';
import { pageSwapAnnotation } from './editorAnnotations';
import { isPageSwap, selectionAfterSync } from './editorPageSync';
import type { EditorSavedState } from './useEditorSave';

interface UseEditorStateParams {
  page: Page;
  viewRef: MutableRefObject<EditorView | null>;
  onUnsavedChanges?: (hasChanges: boolean) => void;
}

// Tekstiredaktori põhiline React-state: lehe sisu, salvestatud baasseis ja dirty-arvutus.
export function useEditorState({ page, viewRef, onUnsavedChanges }: UseEditorStateParams) {
  const [isDirty, setIsDirty] = useState(false);
  const [status, setStatus] = useState(page.status);
  const [comments, setComments] = useState<Annotation[]>(page.comments);
  const [textAnnotations, setTextAnnotations] = useState<TextAnnotation[]>(page.text_annotations || []);
  const [page_tags, setPageTags] = useState<(string | LinkedEntity)[]>(page.page_tags || []);
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  // Salvestamata mustand-tekst kommentaaride paanil (AnnotationsTab) — enne nupule vajutust.
  const [annotationDraftDirty, setAnnotationDraftDirty] = useState(false);
  const [savedState, setSavedState] = useState<EditorSavedState>({
    status: page.status,
    comments: page.comments,
    page_tags: page.page_tags || [],
    text_annotations: page.text_annotations || [],
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

  // Viimati nähtud lehe ID. Effect jookseb iga `page`-objekti asendumise peale,
  // aga ainult osa neist on päris lehevahetus — vt `editorPageSync.ts`.
  const lastPageIdRef = useRef<string | null>(null);

  // Uuendame editori sisu lehe vahetusel.
  useEffect(() => {
    const isSwap = isPageSwap(lastPageIdRef.current, page.id);
    lastPageIdRef.current = page.id;

    // Redaktori oleku lähtestamine AINULT päris lehevahetusel. `page`-objekt
    // asendub ka salvestamisel ja metaandmete salvestamisel (Workspace
    // `setPage`), aga kasutaja on siis endiselt samal leheküljel ja tema
    // salvestamata valikuid ei tohi vana objekti väärtustega üle kirjutada:
    // `setIsDirty(false)` kaotaks hoiatuse ja tekstimuudatused läheksid
    // lehevahetusel kaotsi (#194).
    //
    // Salvestamise järel teeb selle töö `useEditorSave` ise (`runSave` →
    // `setSavedState` + `setIsDirty(false)`), täpselt sellega, mis tegelikult
    // salvestati. Metaandmete modaal ei puuduta redaktori olekut üldse — selle
    // vastus kannab ainult teose-taseme välju (title, year, genre, creators…).
    if (isSwap) {
      setStatus(page.status);
      setComments(page.comments);
      setTextAnnotations(page.text_annotations || []);
      setPageTags(page.page_tags || []);
      setSavedState({ status: page.status, comments: page.comments, page_tags: page.page_tags || [], text_annotations: page.text_annotations || [] });
      setIsDirty(false);
      // Salvestamata kommentaarimustand kuulub eelmisele lehele — muidu jääks
      // hoiatus "salvestamata muudatused" uuel lehel ekslikult püsima.
      setAnnotationDraftDirty(false);
      // Sama põhjus: eelmise lehe salvestusviga ei ole uuel lehel enam asjakohane.
      setSaveError(null);
    }

    const view = viewRef.current;
    if (view) {
      const currentText = view.state.doc.toString();
      if (currentText !== page.text_content) {
        const newText = page.text_content || '';
        view.dispatch({
          changes: { from: 0, to: currentText.length, insert: newText },
          // Lehevahetusel algusesse; sama lehe värskendusel (salvestamine
          // normaliseeris teksti) jääb kursor paigale.
          selection: {
            anchor: selectionAfterSync({
              isSwap,
              currentAnchor: view.state.selection.main.anchor,
              newDocLength: newText.length,
            }),
          },
          // Lehevahetusel tühjendame openMarks — vana positsioon kukuks nulli ja
          // avaks võõra ploki uuel lehel. Sama lehe värskendusel jäävad avatud
          // marginaalia-plokid alles, sest kasutaja on nendega parajasti töös.
          effects: isSwap ? closeAllMarginalia.of(null) : [],
          // Programmaatiline asendus, mitte kasutaja muudatus — updateListener
          // ei tohi seda dirty-ks lugeda (vt editorAnnotations.ts).
          annotations: pageSwapAnnotation.of(true),
        });
      }
      // Kerimine lehe algusesse. Tekstimuutuse tingimusest väljaspool, sest kaks
      // järjestikust lehte võivad olla identse tekstiga (nt tühjad) — ka siis
      // peab uus leht algama ülevalt. Alates #185-st ei monteerita editorit lehe
      // vahetusel maha, seega kerimispositsioon jääks muidu eelmise lehe lõppu.
      // AINULT päris lehevahetusel: salvestamine asendab samuti `page`-objekti,
      // ja kasutaja keset tööd ei tohi kerimist kaotada.
      if (isSwap) view.scrollDOM.scrollTop = 0;
    }
  }, [page, viewRef]);

  // Hoiatus brauseri sulgemise/refreshi korral.
  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (hasUnsavedChanges) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [hasUnsavedChanges]);

  useEffect(() => {
    onUnsavedChanges?.(hasUnsavedChanges);
  }, [hasUnsavedChanges, onUnsavedChanges]);

  return {
    isDirty,
    setIsDirty,
    status,
    setStatus,
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
    annotationDraftDirty,
    setAnnotationDraftDirty,
    savedState,
    setSavedState,
    hasUnsavedChanges,
  };
}
