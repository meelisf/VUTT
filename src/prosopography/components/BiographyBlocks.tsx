import { BookMarked, ScrollText } from 'lucide-react';
import React from 'react';
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

/**
 * Eluloo plokk + Album Academicumi plokk.
 *
 * Otsuse teeb `biographyBlocksModel` (testitud); siin on ainult renderdus.
 * AA-kirje pealkiri on tõlgitud, sisu ei ole — see on struktureeritud
 * allikakirje, mitte tekst (ADR 0039).
 */
const BiographyBlocks: React.FC<Props> = ({ person, lang }) => {
  const { t } = useTranslation(['prosopography']);
  const { biography, aaRecord } = biographyBlocksModel(person, lang);

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
          <div className={HEADER}>
            <span className="text-primary-600"><ScrollText size={18} /></span>
            <h4 className="font-bold">{t('aaRecord')}</h4>
          </div>
          {/* AA-kirje on kirje, mitte Markdown — reavahetused on sisulised. */}
          <pre className="text-xs text-gray-700 whitespace-pre-wrap font-sans leading-relaxed">
            {aaRecord}
          </pre>
        </div>
      )}
    </>
  );
};

export default BiographyBlocks;
