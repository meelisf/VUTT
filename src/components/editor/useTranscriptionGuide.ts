import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { fetchWithTimeout } from '../../utils/fetchWithTimeout';
import { getLangCode } from '../../utils/getLangCode';

// Laeb transkribeerimisjuhendi staatilise HTML-i vastavalt kasutaja keelele.
export function useTranscriptionGuide() {
  const { i18n } = useTranslation(['workspace', 'common']);
  const lang = getLangCode(i18n.language);
  const [showTranscriptionGuide, setShowTranscriptionGuide] = useState(false);
  const [transcriptionGuideHtml, setTranscriptionGuideHtml] = useState<string>('');

  useEffect(() => {
    const loadTranscriptionGuide = async () => {
      try {
        const fileSuffix = lang === 'en' ? '_en' : '';
        const response = await fetchWithTimeout(`/transcription_guide${fileSuffix}.html`, { timeout: 5000 });
        if (response.ok) {
          const html = await response.text();
          const styleMatch = html.match(/<style[^>]*>([\s\S]*?)<\/style>/i);
          const bodyMatch = html.match(/<body[^>]*>([\s\S]*)<\/body>/i);
          const styleTag = styleMatch ? `<style>${styleMatch[1]}</style>` : '';
          const bodyContent = bodyMatch ? bodyMatch[1] : html;
          setTranscriptionGuideHtml(styleTag + bodyContent);
        }
      } catch (e) {
        console.warn('Transkribeerimise juhendi laadimine ebaõnnestus:', e);
      }
    };
    loadTranscriptionGuide();
  }, [lang]);

  return {
    lang,
    showTranscriptionGuide,
    setShowTranscriptionGuide,
    transcriptionGuideHtml,
  };
}
