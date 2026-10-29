import { useState, useEffect, useRef, useCallback, MutableRefObject } from 'react';
import { EditorView } from '@codemirror/view';
import { ApiError, apiDelete, apiGet, apiPost } from '../../services/apiClient';
import { FILE_API_URL } from '../../config';
import { Page } from '../../types';
import { reocrPageIdentity } from './reocrPageIdentity';
import { useJobPoll } from '../../hooks/useJobPoll';

export type ReocrStatus = 'idle' | 'uploading' | 'processing' | 'done' | 'error';

interface UseReOcrProps {
  page: Page;
  authToken: string | null;
  /** Re-OCR endpointid on admin-only — muul juhul ei tehta ühtki päringut. */
  isAdmin: boolean;
  viewRef: MutableRefObject<EditorView | null>;
  setIsDirty: (v: boolean) => void;
  /** OCR-pakkuja. 'gemini' on superadmin-only; backend kontrollib uuesti. */
  provider?: 'loss' | 'gemini';
  /**
   * Kas hook otsib lehe vahetusel ise .ocr faili / localStorage'i pooleliolevat
   * tööd üles. `.ocr` fail on pakkuja-agnostiline, seega kui sama lehe kohta
   * kutsutakse `useReOcr`-i mitu korda (nt eraldi instants Gemini-nupu jaoks),
   * tohib avastamislogika töötada AINULT ühes instantsis — muidu tekiks kaks
   * kattuvat overlay't sama tulemuse jaoks. Vaikimisi true.
   */
  discover?: boolean;
}

interface UseReOcrReturn {
  reocrStatus: ReocrStatus;
  reocrText: string | null;
  reocrError: string | null;
  handleReOcr: () => Promise<void>;
  applyReOcr: () => void;
  deleteOcrFile: () => Promise<void>;
}

const nonJsonError = (status: number, text: string) =>
  new Error(`Server ei tagastanud JSON vastust (${status}). ${text.replace(/\s+/g, ' ').slice(0, 180)}`);

// apiClient annab mitte-JSON-vastuse stringina (nt nginx-i HTML-veakülg 502/504) —
// siin on see viga ja sõnumisse läheb ainult lühike eelvaade.
async function reocrJson(request: Promise<unknown>): Promise<any> {
  try {
    const data = await request;
    if (typeof data === 'string') throw nonJsonError(200, data);
    return data ?? {};
  } catch (e) {
    if (e instanceof ApiError && typeof e.data === 'string') throw nonJsonError(e.status, e.data);
    throw e;
  }
}

export function useReOcr({ page, authToken, isAdmin, viewRef, setIsDirty, provider = 'loss', discover = true }: UseReOcrProps): UseReOcrReturn {
  const [reocrStatus, setReocrStatus] = useState<ReocrStatus>('idle');
  const [reocrText, setReocrText] = useState<string | null>(null);
  const [reocrError, setReocrError] = useState<string | null>(null);
  // Iga uus poll ja lehe vahetus suurendab põlvkonda — vanem tsükkel lõpeb
  // järgmisel sammul vaikselt (lahtimonteerimise katab useJobPoll).
  const pollGenRef = useRef(0);
  const pollJob = useJobPoll();

  const { pageFilename, pageKey, storageKey: reocrStorageKey } = reocrPageIdentity(page.work_id, page.image_url);

  // Editor EI monteeru lehe vahetusel maha (ADR 0010), seega on see olek
  // "kleepuv": ilma selgesõnalise lähtestuseta ripuks eelmise lehe banner ja
  // tulemus kaasa igale järgmisele lehele. pageKeyRef valvab ka pooleliolevate
  // async-vastuste eest — vana lehe poll ei tohi kirjutada uue lehe olekusse.
  const pageKeyRef = useRef<string | null>(pageKey);
  pageKeyRef.current = pageKey;

  /** Jälgib serveri re-OCR tööd kuni lõpuni; `isCurrent` = töö leht on endiselt avatud. */
  const followJob = useCallback(async (jobId: string, token: string, storageKey: string | null,
                                      isCurrent: () => boolean, firstDelayMs: number) => {
    const gen = ++pollGenRef.current;
    setReocrStatus('processing');
    const res = await pollJob<any>({
      request: () => reocrJson(apiGet(`${FILE_API_URL}/admin/reocr/${jobId}/status`, { token, timeout: 10000 })),
      isRunning: (pd) => pd.status !== 'done' && pd.status !== 'error' && pd.status !== 'not_found',
      intervalMs: 3000,
      firstDelayMs,
      retryMs: 4000,
      alive: () => isCurrent() && pollGenRef.current === gen,
    });
    if (res.kind === 'cancelled') return;
    if (res.kind === 'failed') {
      // Olekut ei saa lugeda — töö võib serveris käia, localStorage jääb alles
      // ja lehele naastes leitakse ta uuesti üles.
      setReocrStatus('error');
      setReocrError((res.error as Error)?.message || 'Viga');
      return;
    }
    const pd = res.status;
    if (pd.status === 'done') {
      setReocrStatus('done');
      setReocrText(pd.text ?? '');
      return;
    }
    if (pd.status === 'error') {
      setReocrStatus('error');
      setReocrError(pd.error || null);
    } else {
      setReocrStatus('idle');     // not_found: töö kadus (nt restart)
    }
    if (storageKey) localStorage.removeItem(storageKey);
  }, [pollJob]);

  // Lehe vahetusel: lähtesta olek ja kontrolli UUE lehe seisu.
  // 1. .ocr fail (püsiv, elab serveri restardi üle)
  // 2. localStorage (pooleliolev töö)
  useEffect(() => {
    pollGenRef.current++;
    setReocrStatus('idle');
    setReocrText(null);
    setReocrError(null);

    // Avastamine on ühekordne globaalselt lehe kohta — teine (nt Gemini) instants
    // ei tohi sama .ocr faili / localStorage-kirjet uuesti üles korjata.
    if (!discover) return;

    if (!authToken || !isAdmin || !pageKey || !page.work_id || !pageFilename) return;

    // Kõik hilisemad kirjutused käivad läbi selle valve — kui leht on vahepeal
    // vahetunud (või effect lõppes), visatakse vastus lihtsalt ära.
    let disposed = false;
    const isCurrent = () => !disposed && pageKeyRef.current === pageKey;

    const checkAll = async () => {
      // 1. Kontrolli .ocr faili (elab serveri restardi üle)
      try {
        const data = await reocrJson(apiGet(
          `${FILE_API_URL}/admin/work/${page.work_id}/page-ocr?filename=${encodeURIComponent(pageFilename)}`,
          { token: authToken, timeout: 5000 }
        ));
        if (!isCurrent()) return;
        setReocrStatus('done');
        setReocrText(data.text ?? '');
        localStorage.removeItem(reocrStorageKey!);
        return;
      } catch {
        // .ocr puudub (404) või ühenduse viga — proovime localStorage
      }

      // 2. .ocr puudub — kontrolli localStorage (pooleliolev töö)
      const savedJobId = localStorage.getItem(reocrStorageKey!);
      if (!savedJobId || !isCurrent()) return;

      try {
        const pd = await reocrJson(apiGet(`${FILE_API_URL}/admin/reocr/${savedJobId}/status`, { token: authToken, timeout: 10000 }));
        if (!isCurrent()) return;
        if (pd.status === 'done') {
          setReocrStatus('done');
          setReocrText(pd.text ?? '');
        } else if (pd.status === 'uploading' || pd.status === 'processing') {
          void followJob(savedJobId, authToken, reocrStorageKey, isCurrent, 1000);
        } else {
          localStorage.removeItem(reocrStorageKey!);
        }
      } catch (e) {
        // Server vastas veaga (nt töö kadus restardiga) → pooleliolevat tööd ei ole
        if (e instanceof ApiError && isCurrent()) localStorage.removeItem(reocrStorageKey!);
      }
    };

    checkAll();

    return () => { disposed = true; };
  // pageKey katab work_id + failinime; ülejäänu on sellest tuletatud
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authToken, isAdmin, pageKey, discover]);

  const handleReOcr = useCallback(async () => {
    if (!pageFilename || !authToken || !pageKey) return;

    // Töö kuulub sellele lehele — vastuseid ei tohi rakendada pärast lehe vahetust.
    const jobPageKey = pageKey;
    const isCurrent = () => pageKeyRef.current === jobPageKey;

    pollGenRef.current++;
    setReocrStatus('uploading');
    setReocrText(null);
    setReocrError(null);

    try {
      const { job_id } = await reocrJson(apiPost(`${FILE_API_URL}/admin/work/${page.work_id}/reocr-page`, {
        page_filename: pageFilename,
        page_number: page.page_number,
        provider,
      }, { token: authToken, timeout: 30000 }));
      // job_id salvestatakse ALATI — töö jookseb serveris ka siis, kui kasutaja
      // on vahepeal lehte vahetanud; tagasi tulles leitakse see üles.
      if (reocrStorageKey) localStorage.setItem(reocrStorageKey, job_id);
      if (!isCurrent()) return;
      await followJob(job_id, authToken, reocrStorageKey, isCurrent, 3000);
    } catch (e: any) {
      if (!isCurrent()) return;
      setReocrStatus('error');
      setReocrError(e instanceof ApiError && e.message.startsWith('HTTP ')
        ? 'Re-OCR alustamine ebaõnnestus' : e.message || 'Viga');
    }
  }, [pageFilename, pageKey, page.work_id, page.page_number, authToken, reocrStorageKey, provider, followJob]);

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
      apiDelete(
        `${FILE_API_URL}/admin/work/${page.work_id}/page-ocr?filename=${encodeURIComponent(pageFilename)}`,
        { token: authToken, timeout: 5000 }
      ).catch(() => {});
    }
    if (reocrStorageKey) localStorage.removeItem(reocrStorageKey);
    setReocrStatus('idle');
    setReocrText(null);
  }, [reocrText, reocrStorageKey, pageFilename, authToken, page.work_id, viewRef, setIsDirty]);

  const deleteOcrFile = useCallback(async () => {
    if (!pageFilename || !authToken || !page.work_id) return;
    await apiDelete(
      `${FILE_API_URL}/admin/work/${page.work_id}/page-ocr?filename=${encodeURIComponent(pageFilename)}`,
      { token: authToken, timeout: 5000 }
    ).catch(() => {});
    if (reocrStorageKey) localStorage.removeItem(reocrStorageKey);
    setReocrStatus('idle');
    setReocrText(null);
  }, [pageFilename, authToken, page.work_id, reocrStorageKey]);

  return { reocrStatus, reocrText, reocrError, handleReOcr, applyReOcr, deleteOcrFile };
}
