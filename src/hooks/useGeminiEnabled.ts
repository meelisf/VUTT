import { useState, useEffect } from 'react';
import { getOcrProviders } from '../services/workApi';

/**
 * Kas Gemini re-OCR pakkuja on serveris seadistatud. Ainult superadminile —
 * madalama rolliga kasutajale ei tehta üldse päringut (endpoint on
 * superadmin-only ja tagastaks 403). Kasutab TextEditor ja WorkManage.
 */
export function useGeminiEnabled(authToken: string | null, isSuperadmin: boolean): boolean {
  const [geminiEnabled, setGeminiEnabled] = useState(false);

  useEffect(() => {
    if (!authToken || !isSuperadmin) {
      setGeminiEnabled(false);
      return;
    }

    let cancelled = false;
    getOcrProviders(authToken)
      .then((d) => { if (!cancelled) setGeminiEnabled(Boolean(d.gemini?.enabled)); })
      .catch(() => { if (!cancelled) setGeminiEnabled(false); });

    return () => { cancelled = true; };
  }, [authToken, isSuperadmin]);

  return geminiEnabled;
}
