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
  // Hiljaks jäänud vastus visatakse ära (teose vahetus või järjestikused salvestused, ADR 0010 vaim).
  const reqSeq = useRef(0);
  const count = work.convolute_count || 0;

  // Teose vahetus: eelmise teose plokid kohe maha. Sama teose uuesti laadimisel (eksemplari
  // salvestus) jäävad vanad plokid päringu ajaks nähtavale — muidu plokk vilguks.
  useEffect(() => {
    reqSeq.current += 1;
    setBlocks([]);
  }, [work.work_id]);

  useEffect(() => {
    const seq = ++reqSeq.current;
    if (count === 0) { setBlocks([]); return; }
    getWorkExemplars(work.work_id, authToken)
      .then(res => { if (reqSeq.current === seq) setBlocks(res.convolutes || []); })
      .catch(() => {});
    // `exemplars_rev` (kliendi loendur) annab uue laadimise eksemplaride salvestusel ka siis,
    // kui arv ei muutu. `archive_refs` siin EI ole: Workspace laadib teose objekti uuesti
    // iga tokeni vahetuse peale ja uus massiiv tähendaks asjatut päringut (ADR 0060 vaim).
  }, [work.work_id, count, authToken, work.exemplars_rev]);

  if (blocks.length === 0) return null;

  return (
    <div className="mt-3 pt-3 border-t border-gray-100" data-testid="same-volume-block">
      <p className="text-xs font-semibold text-gray-500 uppercase mb-2">{t('common:convolute.title')}</p>
      <ConvoluteBlocks blocks={blocks} lang={lang} />
    </div>
  );
};

export default SameVolumeBlock;
