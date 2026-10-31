import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Relation, ResolvedRelation, Work } from '../../types';
import { useUser } from '../../contexts/UserContext';
import { useConfirm, useNotify } from '../../contexts/FeedbackContext';
import { changeRelations, fetchRelations, variantRelations } from '../../services/relationsService';
import { isAtLeast } from '../../utils/roleUtils';
import RelatedWorksList from './RelatedWorksList';
import RelatedWorkPicker from './RelatedWorkPicker';

interface RelatedWorksBlockProps {
  work: Work;
  lang: string;
}

const variant = (id: string): Relation => ({ id, rel_type: 'isVersionOf' });

/**
 * Infopaneeli plokk „Seotud teosed" (#701, ADR 0075). Admin lisab/eemaldab
 * siin; salvestus on kohe ja muudab mõlemat teost.
 */
const RelatedWorksBlock: React.FC<RelatedWorksBlockProps> = ({ work, lang }) => {
  const { t } = useTranslation(['common']);
  const { user, authToken } = useUser();
  const notify = useNotify();
  const askConfirm = useConfirm();
  const canEdit = isAtLeast(user?.role, 'admin') && !!authToken;
  const [items, setItems] = useState<ResolvedRelation[]>([]);
  const [picking, setPicking] = useState(false);
  const [saving, setSaving] = useState(false);
  // Teose vahetus sama komponendi sees (variandi link): hiljaks jäänud vastus
  // eelmise teose kohta visatakse ära (ADR 0010 vaim — remount ei lähtesta).
  const currentWork = useRef(work.work_id);
  const variantKey = variantRelations(work.relations).map(r => r.id).join(',');

  useEffect(() => {
    currentWork.current = work.work_id;
    setItems([]);
    setPicking(false);
    // Päring ainult siis, kui teosel on variandiseos (work.relations tuleb Meilist).
    // Admin küsib alati: äsja teiselt poolt lisatud seos ei pruugi Meili koopias
    // veel olla, ja ilma selleta näiks seos ühepoolsena kuni sünkini.
    if (!variantKey && !canEdit) return;
    const workId = work.work_id;
    fetchRelations(workId, authToken || undefined)
      .then(res => { if (currentWork.current === workId) setItems(res); })
      .catch(() => {});
  }, [work.work_id, variantKey, authToken, canEdit]);

  const save = async (change: { add: Relation[]; remove: Relation[] }) => {
    if (!authToken) return;
    const workId = work.work_id;
    setSaving(true);
    try {
      const res = await changeRelations(workId, change, authToken);
      if (currentWork.current === workId) setItems(res);
    } catch {
      notify(t('common:workRelations.saveError', 'Seost ei salvestatud'), 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleRemove = async (rel: ResolvedRelation) => {
    const ok = await askConfirm({
      message: t('common:workRelations.removeConfirm', 'Eemalda seos mõlemalt teoselt?'),
      variant: 'warning',
    });
    if (ok) await save({ add: [], remove: [variant(rel.id)] });
  };

  const handlePick = async (targetId: string) => {
    setPicking(false);
    await save({ add: [variant(targetId)], remove: [] });
  };

  const hasItems = items.some(r => !r.missing);
  if (!hasItems && !canEdit) return null;

  return (
    <div className="mt-3 pt-3 border-t border-gray-100">
      <p className="text-xs font-semibold text-gray-500 uppercase mb-2">
        {t('common:workRelations.title', 'Seotud teosed')}
      </p>
      <RelatedWorksList items={items} lang={lang} onRemove={canEdit && !saving ? handleRemove : undefined} />
      {canEdit && (
        <>
          <button type="button" disabled={saving} onClick={() => setPicking(p => !p)}
                  className="mt-2 text-xs text-primary-700 hover:text-primary-900 disabled:opacity-50">
            {t('common:workRelations.add', '+ Lisa variant')}
          </button>
          {picking && (
            <RelatedWorkPicker
              lang={lang}
              excludeIds={[work.work_id, ...items.map(r => r.id)]}
              onPick={handlePick}
            />
          )}
        </>
      )}
    </div>
  );
};

export default RelatedWorksBlock;
