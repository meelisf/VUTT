import { useCallback, useEffect, useRef, useState, type MutableRefObject } from 'react';
import { EditorView, keymap, lineNumbers } from '@codemirror/view';
import { Compartment, EditorState } from '@codemirror/state';
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import { openSearchPanel, search, searchKeymap } from '@codemirror/search';
import type { Page } from '../../types';
import { vuttMarkupExtension } from './VuttMarkupExtension';
import { closeAllMarginalia, marginaliaExtension, marginaliaField } from './MarginaliaExtension';
import type { MarginaliaMode } from './MarginaliaExtension';
import { vuttTheme } from './VuttTheme';
import { createVuttSearchPanel } from './VuttSearchPanel';

interface UseCodeMirrorLifecycleParams {
  page: Page;
  readOnly: boolean;
  editorContainerRef: MutableRefObject<HTMLDivElement | null>;
  viewRef: MutableRefObject<EditorView | null>;
  handleSaveRef: MutableRefObject<() => void>;
  wrapWithTagRef: MutableRefObject<(tag: string) => void>;
  copyPastePlainMarkup: ReturnType<typeof EditorView.domEventHandlers>;
  setIsDirty: (dirty: boolean) => void;
}

// CodeMirrori instantsi elutsükkel ja marginaalia kuvarežiimi reconfigure.
export function useCodeMirrorLifecycle({
  page,
  readOnly,
  editorContainerRef,
  viewRef,
  handleSaveRef,
  wrapWithTagRef,
  copyPastePlainMarkup,
  setIsDirty,
}: UseCodeMirrorLifecycleParams) {
  const editableCompartmentRef = useRef(new Compartment());
  const marginaliaCompartmentRef = useRef(new Compartment());

  const [marginaliaUserMode, setMarginaliaUserMode] = useState<MarginaliaMode>(
    () => (localStorage.getItem('vutt_marginalia_view') === 'badge' ? 'badge' : 'column')
  );
  const [narrowPane, setNarrowPane] = useState(false);
  // Kitsas paan (kõrvuti aknad) → laiad tekst-sildid kokku ikoonideks.
  // Eraldi (kõrgem) lävend kui narrowPane (640) — sildid kaovad enne badge-režiimi.
  const [compactToolbar, setCompactToolbar] = useState(false);
  const [marginaliaCount, setMarginaliaCount] = useState(0);
  const marginaliaMode: MarginaliaMode = narrowPane ? 'badge' : marginaliaUserMode;

  // Globaalne Ctrl+F käsitleja — avab CM6 otsingu capture-faasis enne brauserit.
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
  }, [viewRef]);

  // CM6 editori loomine (üks kord mount'il).
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
    // Editor luuakse mount'il ainult üks kord; readOnly/page sünk on eraldi effectides.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Uuendame editeeritavust readOnly muutmisel.
  useEffect(() => {
    viewRef.current?.dispatch({
      effects: editableCompartmentRef.current.reconfigure(
        EditorView.editable.of(!readOnly)
      ),
    });
  }, [readOnly, viewRef]);

  // Marginaalia režiimi vahetus: reconfigure + sule avatud plokid
  // (facet'i muutus üksi ei käivita dekoratsioonide ümberehitust — closeAll efekt teeb seda).
  useEffect(() => {
    viewRef.current?.dispatch({
      effects: [
        marginaliaCompartmentRef.current.reconfigure(marginaliaExtension(marginaliaMode)),
        closeAllMarginalia.of(null),
      ],
    });
  }, [marginaliaMode, viewRef]);

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
  }, [editorContainerRef]);

  const toggleMarginaliaMode = useCallback(() => {
    setMarginaliaUserMode(prev => {
      const next = prev === 'column' ? 'badge' : 'column';
      localStorage.setItem('vutt_marginalia_view', next);
      return next;
    });
  }, []);

  return {
    marginaliaUserMode,
    narrowPane,
    compactToolbar,
    marginaliaCount,
    toggleMarginaliaMode,
  };
}
