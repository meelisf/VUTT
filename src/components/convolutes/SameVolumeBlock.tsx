import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ConvoluteBlock, Work } from '../../types';
import { useUser } from '../../contexts/UserContext';
import { getWorkExemplars } from '../../services/workApi';
import ConvoluteBlocks from './ConvoluteBlocks';

interface SameVolumeBlockProps {
  work: Work;
  lang: string;
}

/**
 * Infopaneeli plokk „Samas köites" (#702). Päring ainult siis, kui teose
 * eksemplar on konvoluudis (`convolute_count` Meilist või eksemplaride
 * salvestuse järel serverist) — muidu ei maksa iga lehe avamine lisapäringut.
 */
const SameVolumeBlock: React.FC<SameVolumeBlockProps> = ({ work, lang }) => {
  const { t } = useTranslation(['common']);
  const { authToken } = useUser();
  const [blocks, setBlocks] = useState<ConvoluteBlock[]>([]);
  // Teose vahetus sama komponendi sees: hiljaks jäänud vastus visatakse ära (ADR 0010 vaim).
  const currentWork = useRef(work.work_id);
  const count = work.convolute_count || 0;

  useEffect(() => {
    currentWork.current = work.work_id;
    setBlocks([]);
    if (count === 0) return;
    const workId = work.work_id;
    getWorkExemplars(workId, authToken)
      .then(res => { if (currentWork.current === workId) setBlocks(res.convolutes || []); })
      .catch(() => {});
    // `archive_refs` on dep'is tahtlikult: eksemplaride salvestus MetadataModal-is annab
    // Workspace'ile uue massiivi ka siis, kui konvoluutide arv jääb samaks (nt sisukord muutus).
  }, [work.work_id, count, authToken, work.archive_refs]);

  if (blocks.length === 0) return null;

  return (
    <div className="mt-3 pt-3 border-t border-gray-100" data-testid="same-volume-block">
      <p className="text-xs font-semibold text-gray-500 uppercase mb-2">{t('common:convolute.title')}</p>
      <ConvoluteBlocks blocks={blocks} lang={lang} />
    </div>
  );
};

export default SameVolumeBlock;
