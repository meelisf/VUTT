/** @vitest-environment jsdom */
import { describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { useRef } from 'react';
import { useEditorState } from '../useEditorState';
import { useEditorSave } from '../useEditorSave';
import { PageConflictError, type PageFields, type SaveOutcome } from '../pageConflict';
import { PageStatus, type Annotation, type Page } from '../../../types';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (k: string) => k }) }));

const c1 = { id: 'c1', text: 'küsimus', author: 'u', created_at: '', replies: [] } as unknown as Annotation;
const page = {
  id: 'p1', status: PageStatus.RAW, text_content: 'vana tekst',
  comments: [c1], page_tags: [], text_annotations: [],
} as unknown as Page;

type OnSave = (p: Page, base: PageFields) => Promise<SaveOutcome>;

function useRedaktor(onSave: OnSave, onPageRestored = vi.fn()) {
  const viewRef = useRef<EditorView | null>(null);
  if (!viewRef.current) {
    viewRef.current = new EditorView({ state: EditorState.create({ doc: page.text_content }) });
  }
  const commentFlushRef = useRef(null);
  const st = useEditorState({ page, viewRef });
  const save = useEditorSave({
    page, status: st.status, comments: st.comments, setComments: st.setComments,
    page_tags: st.page_tags, textAnnotations: st.textAnnotations,
    setTextAnnotations: st.setTextAnnotations, onSave,
    savedState: st.savedState, setSavedState: st.setSavedState, setPageTags: st.setPageTags,
    setIsDirty: st.setIsDirty, setIsSaving: st.setIsSaving,
    setSaveError: st.setSaveError, viewRef, commentFlushRef, authToken: 't', onPageRestored,
  });
  return { st, save, viewRef };
}

function trüki(view: EditorView, tekst: string) {
  view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: tekst } });
}

const vastusega = { ...c1, replies: [{ id: 'r1', text: 'vastus' }] } as unknown as Annotation;
const serveris: PageFields = {
  text_content: 'nende tekst', status: PageStatus.CORRECTED, page_tags: [],
  comments: [vastusega], text_annotations: [],
};

describe('lehe salvestuse liitmine redaktoris (#455)', () => {
  it('saadab baasina laaditud seisu', async () => {
    const onSave = vi.fn<OnSave>(async () => ({ merged: null }));
    const { result } = renderHook(() => useRedaktor(onSave));
    trüki(result.current.viewRef.current!, 'minu tekst');
    await act(async () => { await result.current.save.handleSave(); });
    const [saadetud, base] = onSave.mock.calls[0];
    expect(saadetud.text_content).toBe('minu tekst');
    expect(base).toEqual({
      text_content: 'vana tekst', status: PageStatus.RAW, page_tags: [], comments: [c1], text_annotations: [],
    });
    // Järgmise salvestuse baas on see, mis salvestati.
    expect(result.current.st.savedState.text).toBe('minu tekst');
  });

  it('liidetud vastus võetakse üle ja on uus baas', async () => {
    const merged: PageFields = { ...serveris, text_content: 'minu tekst', status: PageStatus.RAW };
    const onSave = vi.fn<OnSave>(async () => ({ merged }));
    const { result } = renderHook(() => useRedaktor(onSave));
    let ok = false;
    await act(async () => { ok = await result.current.save.handleSave(); });
    expect(ok).toBe(true);
    expect(result.current.st.comments).toEqual([vastusega]);
    expect(result.current.st.savedState.comments).toEqual([vastusega]);
    expect(result.current.st.hasUnsavedChanges).toBe(false);
  });

  it('kokkupõrge: midagi ei märgita salvestatuks, dialoog avaneb', async () => {
    const onSave = vi.fn<OnSave>(async () => { throw new PageConflictError(['text'], serveris); });
    const { result } = renderHook(() => useRedaktor(onSave));
    trüki(result.current.viewRef.current!, 'minu tekst');
    act(() => { result.current.st.setIsDirty(true); });
    let ok = true;
    await act(async () => { ok = await result.current.save.handleSave(); });
    expect(ok).toBe(false);
    expect(result.current.save.pageConflict?.fields).toEqual(['text']);
    expect(result.current.st.isDirty).toBe(true);
    expect(result.current.st.saveError).toBeNull();
  });

  it('„Salvesta minu versioon" kordab salvestust baasiga, kus konfliktne üksus on serveri oma', async () => {
    const onSave = vi.fn<OnSave>()
      .mockRejectedValueOnce(new PageConflictError(['text'], serveris))
      .mockResolvedValueOnce({ merged: null });
    const { result } = renderHook(() => useRedaktor(onSave));
    trüki(result.current.viewRef.current!, 'minu tekst');
    await act(async () => { await result.current.save.handleSave(); });
    await act(async () => { await result.current.save.resolveConflictKeepMine(); });
    const [saadetud, base] = onSave.mock.calls[1];
    expect(saadetud.text_content).toBe('minu tekst');
    expect(base.text_content).toBe('nende tekst');   // konfliktis üksus → serveri oma
    expect(base.status).toBe(PageStatus.RAW);        // konfliktita üksus → vana baas
    expect(result.current.save.pageConflict).toBeNull();
  });

  it('„Võta serveri versioon" asendab redaktori seisu ja teatab vanemale', async () => {
    const onPageRestored = vi.fn();
    const onSave = vi.fn<OnSave>(async () => { throw new PageConflictError(['text'], serveris); });
    const { result } = renderHook(() => useRedaktor(onSave, onPageRestored));
    trüki(result.current.viewRef.current!, 'minu tekst');
    await act(async () => { await result.current.save.handleSave(); });
    await act(async () => { await result.current.save.resolveConflictTakeTheirs(); });
    expect(result.current.viewRef.current!.state.doc.toString()).toBe('nende tekst');
    expect(result.current.st.comments).toEqual([vastusega]);
    expect(result.current.st.savedState.text).toBe('nende tekst');
    expect(onPageRestored).toHaveBeenCalledWith(expect.objectContaining({
      text_content: 'nende tekst', status: PageStatus.CORRECTED,
    }));
    expect(result.current.save.pageConflict).toBeNull();
  });
});
