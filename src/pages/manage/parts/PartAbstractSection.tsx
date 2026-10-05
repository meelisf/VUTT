/**
 * Osa avalik sisukokkuvõte kahes keeles (ADR 0063, ADR 0039 muster lihtsustatult):
 * tõlge käib ainult eesti → inglise ja ankur on ainult ingliskeelsel. Ankru seab
 * server kinnituse peale (`confirm_abstract_translation`); vorm ainult hoiatab, kui
 * eestikeelne on pärast kinnitust muutunud.
 */
import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, Languages, Loader2 } from 'lucide-react';
import { translateText } from '../../../prosopography/services/prosopographyService';
import { textHash } from '../../../prosopography/utils/textHash';
import type { PartDraft } from '../partsModel';

type Lang = 'et' | 'en';

interface Props {
  draft: PartDraft;
  set: (patch: Partial<PartDraft>) => void;
  token: string | null;
}

const PartAbstractSection: React.FC<Props> = ({ draft, set, token }) => {
  // prosopography: ühised tõlke-dialoogi tekstid (sama vool mis eluloo vormis).
  const { t } = useTranslation(['workspace', 'prosopography']);
  const tp = (key: string) => t(`manage.parts.${key}`);
  const [tab, setTab] = useState<Lang>('et');
  const [translating, setTranslating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stale, setStale] = useState(false);
  // Vastuse saabumise hetke värske mustand: tõlke ajal võib toimetaja edasi kirjutada.
  const draftRef = useRef(draft);
  draftRef.current = draft;

  // Hoiatus: kinnitatud tõlke ankur ei vasta enam praegusele eestikeelsele tekstile.
  useEffect(() => {
    let cancelled = false;
    if (!draft.abstractAnchor || !draft.abstract_en.trim()) { setStale(false); return; }
    void textHash(draft.abstract_et).then(h => { if (!cancelled) setStale(h !== draft.abstractAnchor); });
    return () => { cancelled = true; };
  }, [draft.abstract_et, draft.abstract_en, draft.abstractAnchor]);

  const field = tab === 'et' ? 'abstract_et' : 'abstract_en';

  const translate = async () => {
    if (!token) return;
    if (draft.abstract_en.trim() && !window.confirm(t('prosopography:form.translateOverwriteConfirm'))) return;
    const before = draft.abstract_et;
    setTranslating(true);
    setError(null);
    try {
      const text = await translateText(before, 'et', 'en', token);
      // Eestikeelne muutus ootamise ajal → tõlge ei vasta sellele; ära kinnita vaikselt.
      if (draftRef.current.abstract_et !== before) setError(t('prosopography:form.translateStaleResult'));
      else set({ abstract_en: text, confirmEn: true });
    } catch {
      setError(tp('translateError'));
    } finally {
      setTranslating(false);
    }
  };

  return (
    <div>
      <div className="flex items-center gap-1 border-b border-gray-100">
        <span className="mr-2 text-xs font-bold uppercase text-gray-500">{tp('abstract')}</span>
        {(['et', 'en'] as Lang[]).map(l => (
          <button key={l} type="button" onClick={() => setTab(l)}
            className={`-mb-px border-b-2 px-2 py-1 text-xs ${tab === l
              ? 'border-primary-600 font-medium text-primary-700' : 'border-transparent text-gray-500 hover:text-gray-700'}`}>
            {tp(l === 'et' ? 'abstractEt' : 'abstractEn')}
          </button>
        ))}
      </div>
      {tab === 'en' && stale && (
        <p className="mt-2 flex items-start gap-1.5 rounded bg-amber-50 px-2 py-1.5 text-xs text-amber-800">
          <AlertTriangle size={13} className="mt-0.5 shrink-0" /> {tp('abstractSourceChanged')}
        </p>
      )}
      <textarea
        aria-label={`${tp('abstract')} (${tp(tab === 'et' ? 'abstractEt' : 'abstractEn')})`}
        className="mt-2 w-full rounded border border-gray-300 px-2 py-1.5 text-sm" rows={5}
        value={draft[field]}
        // Eestikeelse muutmine võtab kinnituse maha: vana tõlge ei vasta uuele tekstile.
        onChange={e => set(tab === 'et' ? { abstract_et: e.target.value, confirmEn: false } : { abstract_en: e.target.value })}
      />
      {tab === 'en' && (
        <div className="mt-1 flex flex-wrap items-center gap-3">
          <button type="button" onClick={() => void translate()} disabled={!token || translating || !draft.abstract_et.trim()}
            className="inline-flex items-center gap-1.5 rounded border border-gray-300 px-2.5 py-1 text-xs text-gray-700 hover:bg-gray-50 disabled:opacity-50">
            {translating ? <Loader2 size={13} className="animate-spin" /> : <Languages size={13} />}
            {tp(translating ? 'translating' : 'translateFromEt')}
          </button>
          <label className="inline-flex items-center gap-1.5 text-xs text-gray-600">
            <input type="checkbox" className="rounded border-gray-300" checked={draft.confirmEn}
              disabled={!draft.abstract_en.trim()} onChange={e => set({ confirmEn: e.target.checked })} />
            {tp('confirmMatches')}
          </label>
        </div>
      )}
      {error && <p className="mt-1 text-xs text-red-700">{error}</p>}
    </div>
  );
};

export default PartAbstractSection;
