import { BookMarked, ScrollText, ChevronDown, ChevronRight } from 'lucide-react';
import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import MarkdownView from '../../components/MarkdownView';
import type { ProsopoRecord } from '../types';
import { biographyBlocksModel } from '../utils/biographyBlocks';
import type { BioLang } from '../utils/biographyChain';

interface Props {
  person: Pick<ProsopoRecord, 'biography_et' | 'biography_en' | 'aa_raw'>;
  lang: BioLang;
}

const CARD = 'bg-white p-5 rounded-lg border border-gray-200 shadow-sm mb-6';
// Sama kuju mis `PersonDetailPage`-i `CardHeader`-il — too on lehesisene ega ole
// eksporditud, aga plokid seisavad kõrvuti ja tohivad kokku sobida.
const HEADER = 'flex items-center gap-2 mb-4 text-gray-800 border-b border-gray-100 pb-2';
// Klapitava ploki päis on nupp — alljoont ei ole, sest lahtioleku piiri
// joonistab sisu enda `border-t`.
const HEADER_BUTTON = 'flex items-center gap-2 text-gray-800 hover:text-primary-700 transition-colors';

/**
 * Eluloo plokk + Album Academicumi plokk.
 *
 * Otsuse teeb `biographyBlocksModel` (testitud); siin on ainult renderdus.
 * AA-kirje pealkiri on tõlgitud, sisu ei ole — see on struktureeritud
 * allikakirje, mitte tekst (ADR 0039).
 *
 * AA-plokk on kokkupandav (sama muster nagu `StructuredInfoCard`): toorik on
 * pikk ja lükkab ülejäänud lehe alla, kui teda parasjagu vaja ei ole. Olekut
 * EI salvestata — see on vaate mugavus, mitte kaardi omadus.
 */
const BiographyBlocks: React.FC<Props> = ({ person, lang }) => {
  const { t } = useTranslation(['prosopography']);
  const { biography, aaRecord } = biographyBlocksModel(person, lang);
  const [aaOpen, setAaOpen] = useState(true);

  if (!biography && !aaRecord) return null;

  return (
    <>
      {biography && (
        <div className={CARD}>
          <div className={HEADER}>
            <span className="text-primary-600"><BookMarked size={18} /></span>
            <h4 className="font-bold">{t('biography')}</h4>
          </div>
          {biography.isFallback && (
            <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1.5 mb-3">
              {biography.lang === 'et' ? t('biographyOnlyEstonian') : t('biographyOnlyEnglish')}
            </p>
          )}
          <MarkdownView content={biography.text} className="text-sm text-gray-800 leading-relaxed" />
        </div>
      )}

      {aaRecord && (
        <div className={CARD}>
          <button
            type="button"
            onClick={() => setAaOpen(v => !v)}
            className={`w-full ${HEADER_BUTTON}`}
            aria-expanded={aaOpen}
          >
            <span className="text-primary-600"><ScrollText size={18} /></span>
            <span className="font-bold">{t('aaRecord')}</span>
            <span className="ml-auto text-gray-400">
              {aaOpen ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
            </span>
          </button>
          {aaOpen && (
            /* AA-kirje on kirje, mitte Markdown — reavahetused on sisulised. */
            <pre className="mt-4 border-t border-gray-100 pt-4 text-xs text-gray-700 whitespace-pre-wrap font-sans leading-relaxed">
              {aaRecord}
            </pre>
          )}
        </div>
      )}
    </>
  );
};

export default BiographyBlocks;
