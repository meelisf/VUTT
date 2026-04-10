import { useState, useEffect, useRef, useCallback, MutableRefObject } from 'react';
import { EditorView } from '@codemirror/view';
import { fetchWithTimeout, getAuthHeaders } from '../../utils/fetchWithTimeout';
import { FILE_API_URL } from '../../config';
import { Page } from '../../types';

export type ReocrStatus = 'idle' | 'uploading' | 'processing' | 'done' | 'error';

interface UseReOcrProps {
  page: Page;
  authToken: string | null;
  viewRef: MutableRefObject<EditorView | null>;
  setIsDirty: (v: boolean) => void;
}

interface UseReOcrReturn {
  reocrStatus: ReocrStatus;
  reocrText: string | null;
  reocrError: string | null;
  handleReOcr: () => Promise<void>;
  applyReOcr: () => void;
  deleteOcrFile: () => Promise<void>;
}

export function useReOcr({ page, authToken, viewRef, setIsDirty }: UseReOcrProps): UseReOcrReturn {
  const [reocrStatus, setReocrStatus] = useState<ReocrStatus>('idle');
  const [reocrText, setReocrText] = useState<string | null>(null);
  const [reocrError, setReocrError] = useState<string | null>(null);
  const reocrPollRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Lehekülje failinimi (piltide URL-ist) — kasutatakse .ocr faili ja localStorage võtme jaoks
  const pageFilename = page.image_url ? (page.image_url.split('/').pop() ?? null) : null;
  // localStorage võti poolelioleva re-OCR töö job_id säilitamiseks
  const reocrStorageKey = page.work_id && pageFilename
    ? `reocr_job_${page.work_id}_${pageFilename}`
    : null;
  const didCheckStoredJobRef = useRef(false);

  // Poll cleanup
  useEffect(() => {
    return () => {
      if (reocrPollRef.current) clearTimeout(reocrPollRef.current);
    };
  }, []);

  // Mountimisel: kontrolli esmalt .ocr faili (püsiv), siis localStorage (pooleliolev töö)
  useEffect(() => {
    if (didCheckStoredJobRef.current || !authToken || !page.work_id || !pageFilename) return;
    didCheckStoredJobRef.current = true;

    const startPollingFromSaved = (jobId: string) => {
      setReocrStatus('processing');
      const poll = async () => {
        try {
          const pr = await fetchWithTimeout(
            `${FILE_API_URL}/admin/reocr/${jobId}/status`,
            { headers: getAuthHeaders(authToken), timeout: 10000 }
          );
          if (!pr.ok) throw new Error('Polling ebaõnnestus');
          const pd = await pr.json();
          if (pd.status === 'done') {
            setReocrStatus('done');
            setReocrText(pd.text ?? '');
          } else if (pd.status === 'error') {
            setReocrStatus('error');
            setReocrError(pd.error || 'Tundmatu viga');
            if (reocrStorageKey) localStorage.removeItem(reocrStorageKey);
          } else if (pd.status === 'not_found') {
            setReocrStatus('idle');
            if (reocrStorageKey) localStorage.removeItem(reocrStorageKey);
          } else {
            reocrPollRef.current = setTimeout(poll, 3000);
          }
        } catch {
          reocrPollRef.current = setTimeout(poll, 4000);
        }
      };
      reocrPollRef.current = setTimeout(poll, 1000);
    };

    const checkAll = async () => {
      // 1. Kontrolli .ocr faili (elab serverirestate üle)
      try {
        const res = await fetchWithTimeout(
          `${FILE_API_URL}/admin/work/${page.work_id}/page-ocr?filename=${encodeURIComponent(pageFilename)}`,
          { headers: getAuthHeaders(authToken), timeout: 5000 }
        );
        if (res.ok) {
          const data = await res.json();
          setReocrStatus('done');
          setReocrText(data.text ?? '');
          if (reocrStorageKey) localStorage.removeItem(reocrStorageKey);
          return;
        }
      } catch {
        // Ühenduse viga — proovime localStorage
      }

      // 2. .ocr puudub — kontrolli localStorage (pooleliolev töö)
      const savedJobId = reocrStorageKey ? localStorage.getItem(reocrStorageKey) : null;
      if (!savedJobId) return;

      try {
        const pr = await fetchWithTimeout(
          `${FILE_API_URL}/admin/reocr/${savedJobId}/status`,
          { headers: getAuthHeaders(authToken), timeout: 10000 }
        );
        const pd = await pr.json();
        if (pd.status === 'done') {
          setReocrStatus('done');
          setReocrText(pd.text ?? '');
        } else if (pd.status === 'uploading' || pd.status === 'processing') {
          startPollingFromSaved(savedJobId);
        } else {
          if (reocrStorageKey) localStorage.removeItem(reocrStorageKey);
        }
      } catch {
        // Eiramine
      }
    };

    checkAll();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authToken]);

  const handleReOcr = useCallback(async () => {
    if (!pageFilename || !authToken) return;

    if (reocrPollRef.current) clearTimeout(reocrPollRef.current);
    setReocrStatus('uploading');
    setReocrText(null);
    setReocrError(null);

    try {
      const res = await fetchWithTimeout(`${FILE_API_URL}/admin/work/${page.work_id}/reocr-page`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAuthHeaders(authToken) },
        body: JSON.stringify({ page_filename: pageFilename, page_number: page.page_number }),
        timeout: 30000,
      });
      if (!res.ok) {
        const d = await res.json();
        throw new Error(d.detail || 'Re-OCR alustamine ebaõnnestus');
      }
      const { job_id } = await res.json();
      if (reocrStorageKey) localStorage.setItem(reocrStorageKey, job_id);
      setReocrStatus('processing');

      const poll = async () => {
        try {
          const pr = await fetchWithTimeout(
            `${FILE_API_URL}/admin/reocr/${job_id}/status`,
            { headers: getAuthHeaders(authToken), timeout: 10000 }
          );
          if (!pr.ok) throw new Error('Polling ebaõnnestus');
          const pd = await pr.json();
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
          reocrPollRef.current = setTimeout(poll, 4000);
        }
      };
      reocrPollRef.current = setTimeout(poll, 3000);
    } catch (e: any) {
      setReocrStatus('error');
      setReocrError(e.message || 'Viga');
    }
  }, [pageFilename, page.work_id, page.page_number, authToken, reocrStorageKey]);

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
