import React from 'react';
import { useTranslation } from 'react-i18next';
import type { ConvoluteBlock } from '../../types';
import ConvoluteBlocks from './ConvoluteBlocks';

interface SameVolumeBlockProps {
  /** Konvoluudi kaaslased `GET /works/{id}/exemplars` vastusest (`useWorkExemplars`). */
  blocks: ConvoluteBlock[];
  lang: string;
}

/** Infopaneeli plokk „Samas köites" (#702). Andmed laeb `useWorkExemplars` koos eksemplaridega. */
const SameVolumeBlock: React.FC<SameVolumeBlockProps> = ({ blocks, lang }) => {
  const { t } = useTranslation(['common']);
  if (blocks.length === 0) return null;

  return (
    <div className="mt-3 pt-3 border-t border-gray-100" data-testid="same-volume-block">
      <p className="text-xs font-semibold text-gray-500 uppercase mb-2">{t('common:convolute.title')}</p>
      <ConvoluteBlocks blocks={blocks} lang={lang} />
    </div>
  );
};

export default SameVolumeBlock;
