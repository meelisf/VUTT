/** @vitest-environment jsdom */
// #641: agendi tekstiettepanek redaktoris — laeb ainult puhtale lehele, ühe hetktõmmisena.
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { useRef } from 'react';
import { PageStatus, type Page } from '../../../types';
import { useEditorState } from '../useEditorState';
import { useTextProposal } from '../useTextProposal';
import { vuttMarkupExtension } from '../VuttMarkupExtension';
import { proposalDiffExtension, proposalDiffField } from '../proposalDiffExtension';

const svc = vi.hoisted(() => ({
  listPacks: vi.fn(), getReviewPage: vi.fn(), rejectPage: vi.fn(), rejectPack: vi.fn(),
  acceptPack: vi.fn(), getJobStatus: vi.fn(), issueHandoff: vi.fn(),
}));
vi.mock('../../../services/textProposalService', () => svc);

const mkPage = (id: string, n: number, text = 'leht vana\n') => ({
  id, work_id: 'w1', page_number: n, status: PageStatus.RAW, text_content: text,
  image_url: `/api/images/slug-w1/t-00${n}.jpg`, comments: [], page_tags: [], text_annotations: [],
}) as unknown as Page;

const PACK = {
  proposal_id: 'p1', work_id: 'w1', note: 'pakk', username: 'a', created_at: 0,
  counts: { pending: 2, stale: 0, accepted: 0, rejected: 0 },
  pages: [{ stem: 't-001', page_no: 1, state: 'pending' }, { stem: 't-003', page_no: 3, state: 'pending' }],
};
const REVIEW = (over = {}) => ({
  proposal_id: 'p1', stem: 't-001', page_no: 1, state: 'pending',
  page: { text_content: 'leht vana\n', status: PageStatus.IN_PROGRESS, page_tags: [], comments: [], text_annotations: [] },
  proposed_now: 'leht uus\n', base_text: 'leht vana\n', proposed_text: 'leht uus\n',
  note: '', pack_note: 'pakk', work_id: 'w1', ...over,
});

const nav = { runGuarded: vi.fn((fn: () => void) => fn()), navigateToPage: vi.fn(), refreshed: vi.fn() };

function useHarness(page: Page, enabled = true) {
  const viewRef = useRef<EditorView | null>(null);
  if (!viewRef.current) {
    viewRef.current = new EditorView({ state: EditorState.create({
      doc: page.text_content, extensions: [vuttMarkupExtension, proposalDiffExtension()] }) });
  }
  const st = useEditorState({ page, viewRef });
  const tp = useTextProposal({
    page, viewRef, enabled, token: 't', hasUnsavedChanges: st.hasUnsavedChanges,
    setSavedState: st.setSavedState, setComments: st.setComments,
    setTextAnnotations: st.setTextAnnotations, setPageTags: st.setPageTags, setIsDirty: st.setIsDirty,
    runGuarded: nav.runGuarded, navigateToPage: nav.navigateToPage,
    onPageRefreshedRef: { current: nav.refreshed }, saveWithDraftsRef: { current: async () => true }, pollMs: 1,
  });
  return { st, tp, viewRef };
}

const doc = (v: EditorView | null) => v!.state.doc.toString();

beforeEach(() => {
  Object.values(svc).forEach(f => f.mockReset());
  Object.values(nav).forEach(f => f.mockClear());
  nav.runGuarded.mockImplementation((fn: () => void) => fn());
  svc.listPacks.mockResolvedValue([PACK]);
  svc.getReviewPage.mockResolvedValue(REVIEW());
});

describe('useTextProposal', () => {
  it('savedState ja tekst samast vastusest; diff sees; viide aktiivne', async () => {
    const { result } = renderHook(() => useHarness(mkPage('a', 1)));
    await waitFor(() => expect(doc(result.current.viewRef.current)).toBe('leht uus\n'));
    expect(result.current.st.savedState.text).toBe('leht vana\n');
    expect(result.current.st.savedState.status).toBe(PageStatus.IN_PROGRESS);
    expect(result.current.st.isDirty).toBe(true);
    expect(result.current.viewRef.current!.state.field(proposalDiffField).base).toBe('leht vana\n');
    expect(result.current.tp.activeRef).toEqual({ id: 'p1', stem: 't-001' });
  });

  it('rakendub ainult puhtale lehele', async () => {
    let lase: (v: unknown) => void = () => {};
    svc.getReviewPage.mockReturnValue(new Promise(r => { lase = r; }));
    const { result } = renderHook(() => useHarness(mkPage('a', 1)));
    await waitFor(() => expect(svc.getReviewPage).toHaveBeenCalled());
    // Päris redaktoris seab dirty `useCodeMirrorLifecycle` updateListener; siin käsitsi.
    act(() => {
      result.current.viewRef.current!.dispatch({ changes: { from: 0, insert: 'x' } });
      result.current.st.setIsDirty(true);
    });
    await act(async () => { lase(REVIEW()); });
    expect(doc(result.current.viewRef.current)).toBe('xleht vana\n');
    expect(result.current.tp.pendingNotLoaded).toBe(true);
    // Laadimata ettepanek: kasutaja enda salvestus EI tohi kanda ettepaneku viidet.
    expect(result.current.tp.activeRef).toBeNull();
    await act(async () => { await result.current.tp.loadIntoEditor(); });
    expect(result.current.tp.activeRef).toEqual({ id: 'p1', stem: 't-001' });
    expect(doc(result.current.viewRef.current)).toBe('leht uus\n');
  });

  it('hilinenud vastus teisel lehel ignoreeritakse', async () => {
    let lase: (v: unknown) => void = () => {};
    svc.getReviewPage.mockReturnValueOnce(new Promise(r => { lase = r; }));
    svc.listPacks.mockResolvedValueOnce([PACK]).mockResolvedValue([]);
    const { result, rerender } = renderHook(({ p }) => useHarness(p), { initialProps: { p: mkPage('a', 1) } });
    await waitFor(() => expect(svc.getReviewPage).toHaveBeenCalled());
    rerender({ p: mkPage('b', 2, 'teine leht\n') });
    await act(async () => { lase(REVIEW()); });
    expect(doc(result.current.viewRef.current)).toBe('teine leht\n');
    expect(result.current.tp.review).toBeNull();
  });

  it('stale ei laadi redaktorisse, aga viide on aktiivne', async () => {
    svc.getReviewPage.mockResolvedValue(REVIEW({ state: 'stale', proposed_now: null }));
    const { result } = renderHook(() => useHarness(mkPage('a', 1)));
    await waitFor(() => expect(result.current.tp.review?.state).toBe('stale'));
    expect(doc(result.current.viewRef.current)).toBe('leht vana\n');
    expect(result.current.tp.activeRef).toEqual({ id: 'p1', stem: 't-001' });
  });

  it('lehepööre lülitab diffi välja', async () => {
    svc.listPacks.mockResolvedValueOnce([PACK]).mockResolvedValue([]);
    const { result, rerender } = renderHook(({ p }) => useHarness(p), { initialProps: { p: mkPage('a', 1) } });
    await waitFor(() => expect(doc(result.current.viewRef.current)).toBe('leht uus\n'));
    rerender({ p: mkPage('b', 2, 'teine leht\n') });
    await waitFor(() => expect(result.current.tp.activeRef).toBeNull());
    expect(result.current.viewRef.current!.state.field(proposalDiffField).base).toBeNull();
  });

  it('väljalülitatud (mitte superadmin) ei päri midagi', async () => {
    renderHook(() => useHarness(mkPage('a', 1), false));
    await new Promise(r => setTimeout(r, 10));
    expect(svc.listPacks).not.toHaveBeenCalled();
  });

  it('lehe tagasilükkamine taastab ketta teksti', async () => {
    svc.rejectPage.mockResolvedValue({ rejected: 1 });
    svc.listPacks.mockResolvedValueOnce([PACK]).mockResolvedValue([]);
    const { result } = renderHook(() => useHarness(mkPage('a', 1)));
    await waitFor(() => expect(doc(result.current.viewRef.current)).toBe('leht uus\n'));
    await act(async () => { await result.current.tp.reject(); });
    expect(svc.rejectPage).toHaveBeenCalledWith('t', 'w1', 'p1', 't-001');
    expect(doc(result.current.viewRef.current)).toBe('leht vana\n');
    expect(result.current.st.isDirty).toBe(false);
    expect(result.current.tp.activeRef).toBeNull();
  });
});


describe('useTextProposal — pakk ja liikumine', () => {
  const PACK3 = { ...PACK, pages: [
    { stem: 't-001', page_no: 1, state: 'pending' }, { stem: 't-002', page_no: 2, state: 'accepted' },
    { stem: 't-003', page_no: 3, state: 'stale' }] };

  it('next hüppab üle otsustatud lehtede, prev puudub esimesel', async () => {
    svc.listPacks.mockResolvedValue([PACK3]);
    const { result } = renderHook(() => useHarness(mkPage('a', 1)));
    await waitFor(() => expect(result.current.tp.next).not.toBeNull());
    expect(result.current.tp.prev).toBeNull();
    act(() => result.current.tp.next!());
    expect(nav.navigateToPage).toHaveBeenCalledWith(3);
  });

  it('kinnitaPakk salvestab enne ja peatub veal', async () => {
    // Päris runGuarded: salvestus ebaõnnestus → toimingut ei käivitata.
    nav.runGuarded.mockImplementation(() => undefined);
    const { result } = renderHook(() => useHarness(mkPage('a', 1)));
    await waitFor(() => expect(result.current.tp.pack).not.toBeNull());
    await act(async () => { result.current.tp.acceptPack(); });
    expect(nav.runGuarded).toHaveBeenCalled();
    expect(svc.acceptPack).not.toHaveBeenCalled();
  });

  it('kinnitaPakk puhtal lehel: töö, pollimine, lehe värskendus', async () => {
    svc.acceptPack.mockResolvedValue(undefined);
    svc.getJobStatus.mockResolvedValueOnce({ state: 'running', done: 0, total: 2 })
      .mockResolvedValue({ state: 'done', result: { accepted: ['t-001', 't-003'], stale: [], skipped: [] } });
    const { result } = renderHook(() => useHarness(mkPage('a', 1)));
    await waitFor(() => expect(result.current.tp.loaded).toBe(true));
    svc.getReviewPage.mockResolvedValue(REVIEW({ state: 'accepted', proposed_now: null,
      page: { ...REVIEW().page, text_content: 'leht uus\n' } }));
    await act(async () => { result.current.tp.acceptPack(); });
    await waitFor(() => expect(result.current.tp.job?.state).toBe('done'));
    expect(svc.acceptPack).toHaveBeenCalledWith('t', 'w1', 'p1');
    await waitFor(() => expect(nav.refreshed).toHaveBeenCalledWith(
      expect.objectContaining({ content: 'leht uus\n' })));
  });

  it('job_running 409 näitab teadet', async () => {
    svc.acceptPack.mockRejectedValue(new Error('job_running'));
    const { result } = renderHook(() => useHarness(mkPage('a', 1)));
    await waitFor(() => expect(result.current.tp.pack).not.toBeNull());
    await act(async () => { result.current.tp.acceptPack(); });
    await waitFor(() => expect(result.current.tp.error).toBe('job_running'));
  });

  it('salvesta ja järgmine liigub ainult eduka salvestuse järel', async () => {
    svc.listPacks.mockResolvedValue([PACK3]);
    const { result } = renderHook(() => useHarness(mkPage('a', 1)));
    await waitFor(() => expect(result.current.tp.next).not.toBeNull());
    await act(async () => { await result.current.tp.saveAndNext(); });
    expect(nav.navigateToPage).toHaveBeenCalledWith(3);
  });
});

describe('useTextProposal — lõppülevaatuse parandused', () => {
  it('„Lae ettepanek" pärast salvestust kasutab värsket hetktõmmist', async () => {
    let lase: (v: unknown) => void = () => {};
    svc.getReviewPage.mockReturnValueOnce(new Promise(r => { lase = r; }));
    const { result, rerender } = renderHook(({ p }) => useHarness(p), { initialProps: { p: mkPage('a', 1) } });
    await waitFor(() => expect(svc.getReviewPage).toHaveBeenCalled());
    act(() => { result.current.st.setIsDirty(true); });
    await act(async () => { lase(REVIEW()); });
    expect(result.current.tp.pendingNotLoaded).toBe(true);
    // Kasutaja salvestas oma muudatuse dialoogis; server liidab ettepaneku uue ketta vastu.
    svc.getReviewPage.mockResolvedValue(REVIEW({
      page: { ...REVIEW().page, text_content: 'minu leht vana\n' }, proposed_now: 'minu leht uus\n' }));
    // Workspace `setPage(savedPage)` pärast salvestust: sama leht, uus tekst.
    rerender({ p: mkPage('a', 1, 'minu leht vana\n') });
    act(() => { result.current.st.setIsDirty(false); });
    await act(async () => { await result.current.tp.loadIntoEditor(); });
    expect(doc(result.current.viewRef.current)).toBe('minu leht uus\n');
    expect(result.current.st.savedState.text).toBe('minu leht vana\n');
  });

  it('pollimine lõpetab püsiva vea korral', async () => {
    svc.acceptPack.mockResolvedValue(undefined);
    svc.getJobStatus.mockRejectedValue(new Error('HTTP 401'));
    const { result } = renderHook(() => useHarness(mkPage('a', 1)));
    await waitFor(() => expect(result.current.tp.pack).not.toBeNull());
    await act(async () => { result.current.tp.acceptPack(); });
    await waitFor(() => expect(result.current.tp.error).toBe('job_status_unavailable'));
    const n = svc.getJobStatus.mock.calls.length;
    await new Promise(r => setTimeout(r, 30));
    expect(svc.getJobStatus.mock.calls.length).toBe(n);
  });

  it('pollimine lõpeb lahtimonteerimisel', async () => {
    svc.acceptPack.mockResolvedValue(undefined);
    svc.getJobStatus.mockResolvedValue({ state: 'running', done: 0, total: 1 });
    const { result, unmount } = renderHook(() => useHarness(mkPage('a', 1)));
    await waitFor(() => expect(result.current.tp.pack).not.toBeNull());
    await act(async () => { result.current.tp.acceptPack(); });
    await waitFor(() => expect(svc.getJobStatus).toHaveBeenCalled());
    unmount();
    const n = svc.getJobStatus.mock.calls.length;
    await new Promise(r => setTimeout(r, 30));
    expect(svc.getJobStatus.mock.calls.length).toBeLessThanOrEqual(n + 1);
  });
});
