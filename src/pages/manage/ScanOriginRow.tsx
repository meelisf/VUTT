import React from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import type { Exemplar } from '../../types';

/**
 * Halduse vahekaardi „Leheküljed" päritolurida (spets „Haldus ja eksemplari leht"):
 * kelle skaneering teose lehed on. Link viib eksemplari lehele — halduse ja
 * eksemplari leht jäävad eraldi. Eksemplarideta teosel rida puudub.
 */
const ScanOriginRow: React.FC<{ workId: string; exemplars: Exemplar[] }> = ({ workId, exemplars }) => {
  const { t } = useTranslation(['workspace']);
  if (exemplars.length === 0) return null;
  const witness = exemplars.find(x => x.text_witness);
  return (
    <div className="px-5 py-2 border-b border-gray-100 text-sm text-gray-600 flex flex-wrap items-center gap-x-2">
      {witness ? (
        <>
          <span>{t('manage.scanOrigin')}</span>
          <Link to={`/work/${workId}/exemplar/${witness.id}`} className="text-primary-700 hover:text-primary-900 hover:underline">
            {[witness.holder, witness.shelfmark].filter(Boolean).join(' ')}
          </Link>
        </>
      ) : (
        <>
          <span className="text-amber-800">{t('manage.scanOriginUnset')} —</span>
          <Link to={`/work/${workId}/exemplar/pages`} className="text-primary-700 hover:text-primary-900 hover:underline">
            {t('manage.scanOriginMark')}
          </Link>
        </>
      )}
    </div>
  );
};

export default ScanOriginRow;
