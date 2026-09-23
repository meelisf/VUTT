/** @vitest-environment jsdom */
import { describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { useRef } from 'react';
import { useEditorState } from '../useEditorState';
import { useEditorSave } from '../useEditorSave';
import { PageStatus, type Page } from '../../../types';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (k: string) => k }) }));

const page = {
  id: 'p1', status: PageStatus.IN_PROGRESS, text_content: 'praegune <ann1>tekst</ann1>',
  comments: [], page_tags: ['Q1'], text_annotations: [{ id: 1, comment: 'm' }],
} as unknown as Page;

function useRedaktor(onPageRestored: (p: Partial<Page>) => void) {
  const viewRef = useRef<EditorView | null>(null);
  if (!viewRef.current) {
    viewRef.current = new EditorView({ state: EditorState.create({ doc: page.text_content }) });
  }
  const commentFlushRef = useRef(null);
  const st = useEditorState({ page, viewRef });
  const save = useEditorSave({
    page, status: st.status, comments: st.comments, setComments: st.setComments,
    page_tags: st.page_tags, textAnnotations: st.textAnnotations,
    setTextAnnotations: st.setTextAnnotations, onSave: async () => {},
    setSavedState: st.setSavedState, setIsDirty: st.setIsDirty, setIsSaving: st.setIsSaving,
    setSaveError: st.setSaveError, viewRef, commentFlushRef, authToken: 't', onPageRestored,
  });
  return { st, save, viewRef };
}

const taaste = {
  content: 'vana tekst', textAnnotations: [],
  comments: [{ id: 'k1', text: 'Endine tekstisisene märkus: m', author: 'u', created_at: '' }],
  gitWarning: null,
};

describe('git-taaste redaktoris (#375)', () => {
  it('taastatud seis on salvestatud seis, mitte salvestamata muudatus', () => {
    const onPageRestored = vi.fn();
    const { result } = renderHook(() => useRedaktor(onPageRestored));

    act(() => result.current.save.handlePageRestored(taaste));

    expect(result.current.viewRef.current!.state.doc.toString()).toBe('vana tekst');
    expect(result.current.st.comments).toEqual(taaste.comments);
    expect(result.current.st.textAnnotations).toEqual([]);
    expect(result.current.st.hasUnsavedChanges).toBe(false);
    // Vanem saab sama teksti — muidu paneks `page` asendus vana teksti tagasi.
    expect(onPageRestored).toHaveBeenCalledWith({
      text_content: 'vana tekst', text_annotations: [], comments: taaste.comments,
    });
  });

  it('salvestamata märksõnamuudatus jääb salvestamata muudatuseks', () => {
    const { result } = renderHook(() => useRedaktor(() => {}));
    act(() => result.current.st.setPageTags(['Q1', 'Q2']));

    act(() => result.current.save.handlePageRestored(taaste));

    expect(result.current.st.page_tags).toEqual(['Q1', 'Q2']);
    expect(result.current.st.hasUnsavedChanges).toBe(true);
  });
});
