import { Languages, Loader2, AlertTriangle } from 'lucide-react';
import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import MarkdownEditor from '../../../components/MarkdownEditor';
import {
  TranslateFailed, fetchSourceDiff, translateText, type SourceDiff,
} from '../../services/prosopographyService';
import type { TranslationAnchor } from '../../types';
import { textHash } from '../../utils/textHash';
import {
  CONFIRM_KEY, OTHER_FIELD, confirmClearPatch, isAnchorStale, isStaleResult,
  needsOverwriteConfirm, translateErrorKey, type BioField,
} from '../../utils/translationFlow';
import type { FormDraft } from './types';

interface Props {
  draft: FormDraft;
  set: (patch: Partial<FormDraft>) => void;
  personId: string | null;
  anchors: { et: TranslationAnchor | null; en: TranslationAnchor | null };
  token: string;
  canEdit: boolean;
}

const TABS: { field: BioField; label: 'biographyEt' | 'biographyEn' }[] = [
  { field: 'biography_et', label: 'biographyEt' },
  { field: 'biography_en', label: 'biographyEn' },
];

/**
 * Eluloo toimetamine kahes keeles.
 *
 * KÕIK otsused tulevad `translationFlow`-st — siin on tabid, nupud ja tekstid.
 * AA-kirje EI ole siin: ta on isikulehe lugemisplokk, mitte toimetatav tekst
 * (ADR 0039).
 */
const BiographySection: React.FC<Props> = ({
  draft, set, personId, anchors, token, canEdit,
}) => {
  const { t } = useTranslation(['prosopography']);
  const [tab, setTab] = useState<BioField>('biography_et');
  const [translating, setTranslating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stale, setStale] = useState<string | null>(null);   // aegunud tõlketulemus
  const [anchorStale, setAnchorStale] = useState(false);
  const [diff, setDiff] = useState<SourceDiff | null>(null);

  // Värske draft vastuse saabumise hetkeks — `translating` ajal võib kasutaja
  // kirjutada ja sulgemisel püütud `draft` oleks vana.
  const draftRef = useRef(draft);
  draftRef.current = draft;

  const source = OTHER_FIELD[tab];
  const sourceLang = source === 'biography_et' ? 'et' : 'en';
  const targetLang = tab === 'biography_et' ? 'et' : 'en';
  const anchor = tab === 'biography_et' ? anchors.et : anchors.en;

  // Vananemishoiatus: kas ankru räsi vastab PRAEGUSELE lähtetekstile?
  useEffect(() => {
    let katkestatud = false;
    textHash(draft[source]).then(hash => {
      if (!katkestatud) setAnchorStale(isAnchorStale(anchor, hash));
    });
    return () => { katkestatud = true; };
  }, [anchor, draft, source]);

  // Tabi vahetusel ei kanta eelmise tabi teateid kaasa.
  useEffect(() => { setError(null); setStale(null); setDiff(null); }, [tab]);

  const applyTranslation = (text: string) => {
    set({ [tab]: text, [CONFIRM_KEY[tab]]: true } as Partial<FormDraft>);
    setStale(null);
  };

  const handleTranslate = async () => {
    setError(null);
    setStale(null);
    if (needsOverwriteConfirm(draft[tab])
        && !window.confirm(t('form.translateOverwriteConfirm'))) {
      return;   // päringut EI saadeta
    }
    const snapshot = {
      biography_et: draft.biography_et,
      biography_en: draft.biography_en,
    };
    setTranslating(true);
    try {
      const tolge = await translateText(draft[source], sourceLang, targetLang, token);
      const praegu = {
        biography_et: draftRef.current.biography_et,
        biography_en: draftRef.current.biography_en,
      };
      if (isStaleResult(snapshot, praegu)) {
        // Tekst muutus ootamise ajal — automaatne kirjutus sööks selle ära.
        setStale(tolge);
      } else {
        applyTranslation(tolge);
      }
    } catch (e) {
      setError(e instanceof TranslateFailed
        ? t(translateErrorKey(e.kind))
        : t('form.translateError'));
    } finally {
      setTranslating(false);
    }
  };

  const handleSourceDiff = async () => {
    if (!personId) return;
    try {
      setDiff(await fetchSourceDiff(personId, tab, token));
    } catch {
      setDiff({ found: false, commit: null, date: null, text: null });
    }
  };

  return (
    <div className="bg-white p-5 rounded-lg border border-gray-200 shadow-sm mb-5">
      <div className="flex items-center gap-1 mb-3 border-b border-gray-100">
        {TABS.map(({ field, label }) => (
          <button
            key={field}
            type="button"
            onClick={() => setTab(field)}
            className={`px-3 py-2 text-xs uppercase tracking-wide border-b-2 -mb-px ${
              tab === field
                ? 'border-primary-600 text-primary-700 font-medium'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            {t(label)}
          </button>
        ))}
      </div>

      {anchorStale && (
        <div className="flex items-start gap-2 text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded px-2 py-1.5 mb-3">
          <AlertTriangle size={14} className="mt-0.5 shrink-0" />
          <span>{t('form.sourceChanged')}</span>
          {personId && (
            <button type="button" onClick={handleSourceDiff}
                    className="underline hover:no-underline whitespace-nowrap">
              {t('form.viewSourceDiff')}
            </button>
          )}
        </div>
      )}

      {diff && (
        <div className="text-xs bg-gray-50 border border-gray-200 rounded p-3 mb-3">
          {diff.found ? (
            <>
              <p className="font-medium text-gray-700 mb-1">{t('form.sourceVersionTitle')}</p>
              <pre className="whitespace-pre-wrap font-sans text-gray-600">{diff.text}</pre>
            </>
          ) : (
            <p className="text-gray-600">{t('form.sourceVersionNotFound')}</p>
          )}
        </div>
      )}

      <MarkdownEditor
        value={draft[tab]}
        onChange={v => set({ [tab]: v, ...confirmClearPatch(tab, draft) } as Partial<FormDraft>)}
        minRows={8}
        disabled={!canEdit}
        placeholder={t(tab === 'biography_et'
          ? 'form.biographyEtPlaceholder'
          : 'form.biographyEnPlaceholder')}
      />

      <div className="flex flex-wrap items-center gap-3 mt-3">
        <button
          type="button"
          onClick={handleTranslate}
          disabled={!canEdit || translating || !draft[source].trim()}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs rounded border border-gray-300 text-gray-700 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {translating
            ? <Loader2 size={14} className="animate-spin" />
            : <Languages size={14} />}
          {translating
            ? t('form.translating')
            : t(sourceLang === 'et' ? 'form.translateFromEstonian' : 'form.translateFromEnglish')}
        </button>

        <label className="inline-flex items-center gap-1.5 text-xs text-gray-600">
          <input
            type="checkbox"
            checked={draft[CONFIRM_KEY[tab]]}
            disabled={!canEdit}
            onChange={e => set({ [CONFIRM_KEY[tab]]: e.target.checked } as Partial<FormDraft>)}
            className="rounded border-gray-300"
          />
          {t(tab === 'biography_et'
            ? 'form.confirmMatchesEnglish'
            : 'form.confirmMatchesEstonian')}
        </label>
      </div>

      {stale !== null && (
        <div className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded px-2 py-1.5 mt-3 flex items-center gap-2">
          <span>{t('form.translateStaleResult')}</span>
          <button type="button" onClick={() => applyTranslation(stale)}
                  className="underline hover:no-underline whitespace-nowrap">
            {t('form.translateApplyAnyway')}
          </button>
        </div>
      )}

      {error && (
        <p className="text-xs text-red-700 bg-red-50 border border-red-200 rounded px-2 py-1.5 mt-3">
          {error}
        </p>
      )}
    </div>
  );
};

export default BiographySection;
