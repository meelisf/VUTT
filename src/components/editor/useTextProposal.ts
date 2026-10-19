/**
 * Agendi tekstiettepanek Workspace'i redaktoris (#641).
 *
 * Lehe avamisel küsitakse, kas sellel lehel on ülevaatust vajav (pending/stale)
 * ettepanek. Server tagastab lehe vaate JA selle vastu liidetud kandidaadi ühest
 * hetktõmmisest; need rakendatakse koos: vaade → salvestatud seis (`base`),
 * kandidaat → redaktori tekst (salvestamata muudatus, diff esile tõstetud).
 * Rakendub ainult puhtale lehele — salvestamata tööd üle ei kirjutata.
 * Lehe identiteet on `page.id` (ADR 0060: perioodiline token ei laadi uuesti).
 */
import { useCallback, useEffect, useRef, useState, type Dispatch, type MutableRefObject, type SetStateAction } from 'react';
import type { EditorView } from '@codemirror/view';
import type { Annotation, Page, TextAnnotation } from '../../types';
import type { LinkedEntity } from '../../types/LinkedEntity';
import type { ProposalRef } from '../../services/pageService';
import {
  acceptPack as acceptPackApi, getJobStatus, getReviewPage, listPacks, rejectPack as rejectPackApi, rejectPage,
  type ProposalJob, type ProposalPageReview, type TextProposalPack,
} from '../../services/textProposalService';
import type { RestoreResult } from './pageRestore';
import { pageFileFromImageUrl } from '../../services/workImageService';
import { pageSwapAnnotation } from './editorAnnotations';
import { setProposalBase } from './proposalDiffExtension';
import type { EditorSavedState } from './useEditorSave';

interface UseTextProposalParams {
  page: Page;
  viewRef: MutableRefObject<EditorView | null>;
  /** Ainult superadmin (ADR 0058 täiendus 2026-10-19). */
  enabled: boolean;
  token: string | null | undefined;
  hasUnsavedChanges: boolean;
  setSavedState: Dispatch<SetStateAction<EditorSavedState>>;
  setComments: (c: Annotation[]) => void;
  setTextAnnotations: (a: TextAnnotation[]) => void;
  setPageTags: (t: (string | LinkedEntity)[]) => void;
  setIsDirty: (d: boolean) => void;
  /** Workspace'i ühtne salvestamata muudatuste dialoog (salvesta / loobu / tühista). */
  runGuarded: (fn: () => void) => void;
  navigateToPage: (pageNo: number) => void;
  /** `handlePageRestored` (useEditorSave luuakse hiljem, seega ref). */
  onPageRefreshedRef: MutableRefObject<((r: RestoreResult) => void) | null>;
  saveWithDraftsRef: MutableRefObject<(() => Promise<boolean>) | null>;
  pollMs?: number;
}

const REVIEW_STATES = new Set(['pending', 'stale']);
const MAX_POLL_ERRORS = 10;

export const pageStem = (page: Page) => pageFileFromImageUrl(page.image_url || '').replace(/\.[^/.]+$/, '');

export function useTextProposal({
  page, viewRef, enabled, token, hasUnsavedChanges,
  setSavedState, setComments, setTextAnnotations, setPageTags, setIsDirty,
  runGuarded, navigateToPage, onPageRefreshedRef, saveWithDraftsRef, pollMs = 1500,
}: UseTextProposalParams) {
  const [job, setJob] = useState<ProposalJob | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pack, setPack] = useState<TextProposalPack | null>(null);
  const [review, setReview] = useState<ProposalPageReview | null>(null);
  const [pendingNotLoaded, setPendingNotLoaded] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const tokenRef = useRef(token);
  tokenRef.current = token;
  const dirtyRef = useRef(hasUnsavedChanges);
  dirtyRef.current = hasUnsavedChanges;
  // Vastus kehtib ainult lehele, millele see küsiti (hilinenud vastus teisel lehel).
  const pageIdRef = useRef(page.id);
  pageIdRef.current = page.id;

  const workId = page.work_id;
  const stem = pageStem(page);

  const apply = useCallback((r: ProposalPageReview) => {
    const view = viewRef.current;
    if (!view || !r.page || r.proposed_now === null) return;
    const p = r.page;
    setSavedState({ text: p.text_content, status: p.status, comments: p.comments,
      page_tags: p.page_tags, text_annotations: p.text_annotations });
    setComments(p.comments);
    setTextAnnotations(p.text_annotations);
    setPageTags(p.page_tags);
    // Ilma userEvent'ita (nagu re-OCR rakendus): sanitiseerijad ei puuduta,
    // tekst on serveris juba normaliseeritud. Dirty seatakse selgesõnaliselt.
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: r.proposed_now },
      effects: setProposalBase.of(p.text_content),
    });
    setIsDirty(true);
    setLoaded(true);
    setPendingNotLoaded(false);
  }, [viewRef, setSavedState, setComments, setTextAnnotations, setPageTags, setIsDirty]);

  const clearDiff = useCallback(() => {
    viewRef.current?.dispatch({ effects: setProposalBase.of(null) });
  }, [viewRef]);

  const load = useCallback(async () => {
    const t = tokenRef.current;
    const forPage = page.id;
    if (!enabled || !t || !workId) return;
    const packs = await listPacks(t, workId).catch(() => [] as TextProposalPack[]);
    if (pageIdRef.current !== forPage) return;
    const own = packs.find(p => p.pages.some(pg => pg.stem === stem && REVIEW_STATES.has(pg.state))) ?? null;
    setPack(own ?? packs[0] ?? null);
    if (!own) return;
    const r = await getReviewPage(t, workId, own.proposal_id, stem).catch(() => null);
    if (!r || pageIdRef.current !== forPage) return;
    setReview(r);
    if (r.state === 'pending' && r.proposed_now !== null) {
      if (dirtyRef.current) setPendingNotLoaded(true);
      else apply(r);
    }
  }, [enabled, page.id, workId, stem, apply]);

  useEffect(() => {
    setPack(null);
    setReview(null);
    setError(null);
    setLoaded(false);
    setPendingNotLoaded(false);
    clearDiff();
    void load();
    // Ainult lehe vahetus (ADR 0060): token/kasutaja uuendus ei laadi uuesti.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page.id, enabled]);

  // Viide salvestusele ainult siis, kui ettepanek ON redaktoris (või aegunud lehe
  // käsitsi ülevõtmisel) — laadimata ettepaneku kõrval on salvestus kasutaja oma töö.
  const activeRef: ProposalRef | null =
    review && (loaded || review.state === 'stale') ? { id: review.proposal_id, stem: review.stem } : null;

  /** „Lae ettepanek" — kutsuja on salvestamata muudatused juba lahendanud (dialoog).
   * Küsitakse UUESTI: dialoogi „Salvesta" muutis ketast ja vana vastus oleks vale
   * hetktõmmis (salvestatud seis + kandidaat peavad olema samast lugemisest). */
  const loadIntoEditor = useCallback(async () => {
    const t = tokenRef.current;
    const forPage = page.id;
    if (!review || !t) return;
    const r = await getReviewPage(t, review.work_id, review.proposal_id, review.stem).catch(() => null);
    if (!r || pageIdRef.current !== forPage) return;
    setReview(r);
    if (r.state === 'pending' && r.proposed_now !== null) apply(r);
    else setPendingNotLoaded(false);
  }, [review, apply, page.id]);

  /** Lehe tagasilükkamine: redaktor tagasi ketta tekstile. */
  const reject = useCallback(async () => {
    const t = tokenRef.current;
    if (!review || !t) return;
    await rejectPage(t, review.work_id, review.proposal_id, review.stem);
    const view = viewRef.current;
    if (view && loaded && review.page) {
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: review.page.text_content },
        effects: setProposalBase.of(null),
        annotations: pageSwapAnnotation.of(true),
      });
      setIsDirty(false);
    } else {
      clearDiff();
    }
    setReview(null);
    setLoaded(false);
    setPendingNotLoaded(false);
    const t2 = tokenRef.current;
    if (t2 && workId) setPack((await listPacks(t2, workId).catch(() => []))[0] ?? null);
  }, [review, loaded, viewRef, setIsDirty, clearDiff, workId]);

  /** Pärast edukat salvestust viitega: ettepanek on otsustatud, diff välja. */
  const afterSave = useCallback(async () => {
    clearDiff();
    setReview(null);
    setLoaded(false);
    const t = tokenRef.current;
    if (t && workId) setPack((await listPacks(t, workId).catch(() => []))[0] ?? null);
  }, [clearDiff, workId]);

  // Ülevaatust vajavad lehed teose järjekorras; praegune leht välja jäetud.
  const others = (pack?.pages ?? []).filter(pg => REVIEW_STATES.has(pg.state) && pg.stem !== stem);
  const nextPage = others.find(pg => pg.page_no > page.page_number);
  const prevPage = [...others].reverse().find(pg => pg.page_no < page.page_number);
  const next = nextPage ? () => navigateToPage(nextPage.page_no) : null;
  const prev = prevPage ? () => navigateToPage(prevPage.page_no) : null;

  const saveAndNext = useCallback(async () => {
    const target = nextPage?.page_no;
    const ok = await saveWithDraftsRef.current?.();
    if (ok && target) navigateToPage(target);
  }, [nextPage?.page_no, saveWithDraftsRef, navigateToPage]);

  /** Paki töö lõpus: aktiivne leht kettalt (salvestatud seis), pakk uuesti. */
  const refreshAfterJob = useCallback(async (proposalId: string) => {
    const t = tokenRef.current;
    if (!t || !workId) return;
    clearDiff();
    setReview(null);
    setLoaded(false);
    if (pack?.pages.some(pg => pg.stem === stem)) {
      const r = await getReviewPage(t, workId, proposalId, stem).catch(() => null);
      if (r?.page && pageIdRef.current === page.id) {
        onPageRefreshedRef.current?.({ content: r.page.text_content, textAnnotations: r.page.text_annotations,
          comments: r.page.comments, gitWarning: null });
      }
    }
    await load();
  }, [workId, pack, stem, page.id, clearDiff, onPageRefreshedRef, load]);

  const mountedRef = useRef(true);
  useEffect(() => () => { mountedRef.current = false; }, []);

  const poll = useCallback(async (proposalId: string) => {
    const t = tokenRef.current;
    if (!t || !workId) return;
    // Lagi: püsiv võrgu-/autentimisviga ei tohi pollida lõputult; lahtimonteerimisel stopp.
    let vigu = 0;
    while (mountedRef.current) {
      await new Promise(r => setTimeout(r, pollMs));
      if (!mountedRef.current) return;
      const st = await getJobStatus(t, workId).catch(() => null);
      if (!st) {
        if (++vigu >= MAX_POLL_ERRORS) {
          setJob(null);
          setError('job_status_unavailable');
          return;
        }
        continue;
      }
      vigu = 0;
      setJob(st);
      if (st.state !== 'running') break;
    }
    if (mountedRef.current) await refreshAfterJob(proposalId);
  }, [workId, pollMs, refreshAfterJob]);

  /** „Kinnita kogu pakk": salvestamata muudatused lahendab ühtne dialoog ENNE. */
  const acceptPack = useCallback(() => {
    const proposalId = pack?.proposal_id;
    if (!proposalId || !workId) return;
    runGuarded(() => {
      void (async () => {
        const t = tokenRef.current;
        if (!t) return;
        setError(null);
        try {
          await acceptPackApi(t, workId, proposalId);
        } catch (e) {
          setError((e as Error).message);
          return;
        }
        setJob({ state: 'running', done: 0, total: 0 });
        await poll(proposalId);
      })();
    });
  }, [pack?.proposal_id, workId, runGuarded, poll]);

  const rejectPack = useCallback(async () => {
    const t = tokenRef.current;
    if (!pack || !t || !workId) return;
    try {
      await rejectPackApi(t, workId, pack.proposal_id);
    } catch (e) {
      setError((e as Error).message);
      return;
    }
    const view = viewRef.current;
    if (view && loaded && review?.page) {
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: review.page.text_content },
        effects: setProposalBase.of(null),
        annotations: pageSwapAnnotation.of(true),
      });
      setIsDirty(false);
    } else {
      clearDiff();
    }
    setReview(null);
    setLoaded(false);
    setPendingNotLoaded(false);
    await load();
  }, [pack, workId, viewRef, loaded, review, setIsDirty, clearDiff, load]);

  return {
    pack, review, pendingNotLoaded, loaded, activeRef, job, error,
    loadIntoEditor, reject, rejectPack, acceptPack, saveAndNext, next, prev, afterSave, reload: load,
  };
}
