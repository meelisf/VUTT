import { useState, useEffect, useRef, useCallback, MutableRefObject } from 'react';
import { EditorView } from '@codemirror/view';
import { fetchWithTimeout, getAuthHeaders } from '../../utils/fetchWithTimeout';
import { FILE_API_URL } from '../../config';
import { Page } from '../../types';
import { reocrPageIdentity } from './reocrPageIdentity';

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

const parseJsonResponse = async (response: Response): Promise<any> => {
  const text = await response.text();
  if (!text.trim()) return {};
  try {
    return JSON.parse(text);
  } catch {
    const preview = text.replace(/\s+/g, ' ').slice(0, 180);
    throw new Error(`Server ei tagastanud JSON vastust (${response.status}). ${preview}`);
  }
};

export function useReOcr({ page, authToken, isAdmin, viewRef, setIsDirty, provider = 'loss', discover = true }: UseReOcrProps): UseReOcrReturn {
  const [reocrStatus, setReocrStatus] = useState<ReocrStatus>('idle');
  const [reocrText, setReocrText] = useState<string | null>(null);
  const [reocrError, setReocrError] = useState<string | null>(null);
  const reocrPollRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const { pageFilename, pageKey, storageKey: reocrStorageKey } = reocrPageIdentity(page.work_id, page.image_url);

  // Editor EI monteeru lehe vahetusel maha (ADR 0010), seega on see olek
  // "kleepuv": ilma selgesõnalise lähtestuseta ripuks eelmise lehe banner ja
  // tulemus kaasa igale järgmisele lehele. pageKeyRef valvab ka pooleliolevate
  // async-vastuste eest — vana lehe poll ei tohi kirjutada uue lehe olekusse.
  const pageKeyRef = useRef<string | null>(pageKey);
  pageKeyRef.current = pageKey;

  // Poll cleanup komponendi mahavõtmisel
  useEffect(() => {
    return () => {
      if (reocrPollRef.current) clearTimeout(reocrPollRef.current);
    };
  }, []);

  // Lehe vahetusel: lähtesta olek ja kontrolli UUE lehe seisu.
  // 1. .ocr fail (püsiv, elab serveri restardi üle)
  // 2. localStorage (pooleliolev töö)
  useEffect(() => {
    if (reocrPollRef.current) {
      clearTimeout(reocrPollRef.current);
      reocrPollRef.current = null;
    }
    setReocrStatus('idle');
    setReocrText(null);
    setReocrError(null);

    // Avastamine on ühekordne globaalselt lehe kohta — teine (nt Gemini) instants
    // ei tohi sama .ocr faili / localStorage-kirjet uuesti üles korjata.
    if (!discover) return;

    if (!authToken || !isAdmin || !pageKey || !page.work_id || !pageFilename) return;

    // Kõik hilisemad kirjutused käivad läbi selle valve — kui leht on vahepeal
    // vahetunud, visatakse vastus lihtsalt ära.
    const isCurrent = () => pageKeyRef.current === pageKey;

    const startPollingFromSaved = (jobId: string) => {
      setReocrStatus('processing');
      const poll = async () => {
        if (!isCurrent()) return;
        try {
          const pr = await fetchWithTimeout(
            `${FILE_API_URL}/admin/reocr/${jobId}/status`,
            { headers: getAuthHeaders(authToken), timeout: 10000 }
          );
          if (!pr.ok) throw new Error('Polling ebaõnnestus');
          const pd = await parseJsonResponse(pr);
          if (!isCurrent()) return;
          if (pd.status === 'done') {
            setReocrStatus('done');
            setReocrText(pd.text ?? '');
          } else if (pd.status === 'error') {
            setReocrStatus('error');
            setReocrError(pd.error || 'Tundmatu viga');
            localStorage.removeItem(reocrStorageKey!);
          } else if (pd.status === 'not_found') {
            setReocrStatus('idle');
            localStorage.removeItem(reocrStorageKey!);
          } else {
            reocrPollRef.current = setTimeout(poll, 3000);
          }
        } catch {
          if (isCurrent()) reocrPollRef.current = setTimeout(poll, 4000);
        }
      };
      reocrPollRef.current = setTimeout(poll, 1000);
    };

    const checkAll = async () => {
      // 1. Kontrolli .ocr faili (elab serveri restardi üle)
      try {
        const res = await fetchWithTimeout(
          `${FILE_API_URL}/admin/work/${page.work_id}/page-ocr?filename=${encodeURIComponent(pageFilename)}`,
          { headers: getAuthHeaders(authToken), timeout: 5000 }
        );
        if (!isCurrent()) return;
        if (res.ok) {
          const data = await parseJsonResponse(res);
          if (!isCurrent()) return;
          setReocrStatus('done');
          setReocrText(data.text ?? '');
          localStorage.removeItem(reocrStorageKey!);
          return;
        }
      } catch {
        // Ühenduse viga — proovime localStorage
      }

      // 2. .ocr puudub — kontrolli localStorage (pooleliolev töö)
      const savedJobId = localStorage.getItem(reocrStorageKey!);
      if (!savedJobId || !isCurrent()) return;

      try {
        const pr = await fetchWithTimeout(
          `${FILE_API_URL}/admin/reocr/${savedJobId}/status`,
          { headers: getAuthHeaders(authToken), timeout: 10000 }
        );
        const pd = await parseJsonResponse(pr);
        if (!isCurrent()) return;
        if (pd.status === 'done') {
          setReocrStatus('done');
          setReocrText(pd.text ?? '');
        } else if (pd.status === 'uploading' || pd.status === 'processing') {
          startPollingFromSaved(savedJobId);
        } else {
          localStorage.removeItem(reocrStorageKey!);
        }
      } catch {
        // Eiramine
      }
    };

    checkAll();

    return () => {
      if (reocrPollRef.current) {
        clearTimeout(reocrPollRef.current);
        reocrPollRef.current = null;
      }
    };
  // pageKey katab work_id + failinime; ülejäänu on sellest tuletatud
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authToken, isAdmin, pageKey, discover]);

  const handleReOcr = useCallback(async () => {
    if (!pageFilename || !authToken || !pageKey) return;

    // Töö kuulub sellele lehele — vastuseid ei tohi rakendada pärast lehe vahetust.
    const jobPageKey = pageKey;
    const isCurrent = () => pageKeyRef.current === jobPageKey;

    if (reocrPollRef.current) clearTimeout(reocrPollRef.current);
    setReocrStatus('uploading');
    setReocrText(null);
    setReocrError(null);

    try {
      const res = await fetchWithTimeout(`${FILE_API_URL}/admin/work/${page.work_id}/reocr-page`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAuthHeaders(authToken) },
        body: JSON.stringify({
          page_filename: pageFilename,
          page_number: page.page_number,
          provider,
        }),
        timeout: 30000,
      });
      if (!res.ok) {
        const d = await parseJsonResponse(res);
        throw new Error(d.detail || 'Re-OCR alustamine ebaõnnestus');
      }
      const { job_id } = await parseJsonResponse(res);
      // job_id salvestatakse ALATI — töö jookseb serveris ka siis, kui kasutaja
      // on vahepeal lehte vahetanud; tagasi tulles leitakse see üles.
      if (reocrStorageKey) localStorage.setItem(reocrStorageKey, job_id);
      if (!isCurrent()) return;
      setReocrStatus('processing');

      const poll = async () => {
        if (!isCurrent()) return;
        try {
          const pr = await fetchWithTimeout(
            `${FILE_API_URL}/admin/reocr/${job_id}/status`,
            { headers: getAuthHeaders(authToken), timeout: 10000 }
          );
          if (!pr.ok) throw new Error('Polling ebaõnnestus');
          const pd = await parseJsonResponse(pr);
          if (!isCurrent()) return;
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
          if (isCurrent()) reocrPollRef.current = setTimeout(poll, 4000);
        }
      };
      reocrPollRef.current = setTimeout(poll, 3000);
    } catch (e: any) {
      if (!isCurrent()) return;
      setReocrStatus('error');
      setReocrError(e.message || 'Viga');
    }
  }, [pageFilename, pageKey, page.work_id, page.page_number, authToken, reocrStorageKey, provider]);

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
        `${FILE_API_URL}/admin/work/${page.work_id}/page-ocr?filename=${encodeURIComponent(pageFilename)}`,
        { method: 'DELETE', headers: getAuthHeaders(authToken), timeout: 5000 }
      ).catch(() => {});
    }
    if (reocrStorageKey) localStorage.removeItem(reocrStorageKey);
    setReocrStatus('idle');
    setReocrText(null);
  }, [reocrText, reocrStorageKey, pageFilename, authToken, page.work_id, viewRef, setIsDirty]);

  const deleteOcrFile = useCallback(async () => {
    if (!pageFilename || !authToken || !page.work_id) return;
    await fetchWithTimeout(
      `${FILE_API_URL}/admin/work/${page.work_id}/page-ocr?filename=${encodeURIComponent(pageFilename)}`,
      { method: 'DELETE', headers: getAuthHeaders(authToken), timeout: 5000 }
    ).catch(() => {});
    if (reocrStorageKey) localStorage.removeItem(reocrStorageKey);
    setReocrStatus('idle');
    setReocrText(null);
  }, [pageFilename, authToken, page.work_id, reocrStorageKey]);

  return { reocrStatus, reocrText, reocrError, handleReOcr, applyReOcr, deleteOcrFile };
}
