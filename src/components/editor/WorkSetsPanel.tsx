/**
 * Teose töökollektsioonid — „kõrgema taseme märksõna" (#354).
 *
 * Asub `WorkInfoPanel`-i ja `WorkTagsPanel`-i vahel, sest kuuluvus on teose
 * kohta käiv väide nagu märksõngi, ainult kuraatori, mitte sisu tasandil.
 *
 * Kuuluvus tuleb serverilt (`/work-sets/for-work/{id}`), mitte kliendipoolsest
 * loendite läbikäimisest: server teab, milliseid kogusid kutsuja üldse näeb, ja
 * väldib N päringut.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Users, X, Plus, Loader2 } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useCollection } from '../../contexts/CollectionContext';
import {
  WorkSetSummary, getWorkSetsForWork, addWorks, removeWorks, invalidateWorkSetIds,
} from '../../services/workSetService';
import WorkSetPicker from '../WorkSetPicker';
import { getLangCode } from '../../utils/getLangCode';

interface WorkSetsPanelProps {
  workId?: string;
  lang: string;
  readOnly?: boolean;
}

const WorkSetsPanel: React.FC<WorkSetsPanelProps> = ({ workId, lang, readOnly }) => {
  const { t } = useTranslation(['common']);
  const { workSets, refreshWorkSets, setSelection } = useCollection();
  const navigate = useNavigate();
  const keel = getLangCode(lang);

  const [kuuluvus, setKuuluvus] = useState<WorkSetSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);

  const managesAny = workSets.some(ws => ws.can_manage && ws.status === 'active');

  const lae = useCallback(async () => {
    if (!workId) return;
    try {
      setKuuluvus(await getWorkSetsForWork(workId));
      setError(null);
    } catch {
      // Viga on NÄHTAV: tühi paneel tähendaks „ei kuulu kuhugi", mis on
      // hoopis teine väide kui „ei saanud teada".
      setKuuluvus([]);
      setError(t('workSets.loadFailed', 'Töökollektsioonide laadimine ebaõnnestus'));
    }
  }, [workId, t]);

  useEffect(() => { lae(); }, [lae]);

  // Paneel on nähtav ainult siis, kui on midagi näidata või midagi teha.
  // Anonüümsele lugejale, kes ühtki kogu ei näe, oleks tühi kast müra.
  if (!workId) return null;
  if (kuuluvus === null) return null;
  if (kuuluvus.length === 0 && (!managesAny || readOnly)) return null;

  const lisa = async (setId: string) => {
    setBusy(true);
    try {
      await addWorks(setId, [workId]);
      invalidateWorkSetIds(setId);
      await lae();
      await refreshWorkSets();
      setError(null);
    } catch (e) {
      const status = (e as { status?: number }).status;
      setError(status === 409
        ? t('workSets.limitReachedShort', 'Kogu on täis')
        : t('workSets.addFailed', 'Lisamine ebaõnnestus'));
    } finally {
      setBusy(false);
      setPickerOpen(false);
    }
  };

  const eemalda = async (setId: string) => {
    setBusy(true);
    try {
      await removeWorks(setId, [workId]);
      invalidateWorkSetIds(setId);
      await lae();
      setError(null);
    } catch {
      setError(t('workSets.addFailed', 'Lisamine ebaõnnestus'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="bg-white p-5 rounded-lg border border-gray-200 shadow-sm mb-6">
      <div className="flex items-center justify-between gap-2 mb-4 text-gray-800 border-b border-gray-100 pb-2">
        <div className="flex items-center gap-2">
          <Users size={18} className="text-indigo-600" />
          <h4 className="font-bold">{t('workSets.workPanelTitle', 'Töökollektsioonid')}</h4>
        </div>
        {managesAny && !readOnly && (
          <button
            onClick={() => setPickerOpen(true)}
            disabled={busy}
            className="inline-flex items-center gap-1 text-sm text-indigo-700 hover:text-indigo-900 disabled:opacity-50"
          >
            {busy ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
            {t('workSets.addTo', 'Lisa töökollektsiooni')}
          </button>
        )}
      </div>

      {error && <p className="text-sm text-red-600 mb-2">{error}</p>}

      {kuuluvus.length === 0 ? (
        <p className="text-sm text-gray-400">{t('workSets.notInAny', 'Teos ei kuulu ühtegi töökollektsiooni')}</p>
      ) : (
        <div className="flex flex-wrap gap-2">
          {kuuluvus.map(ws => (
            <div
              key={ws.id}
              className="inline-flex items-center bg-indigo-50 border border-indigo-100 rounded-full overflow-hidden"
            >
              <button
                onClick={() => {
                  // Kogule klõps viib töölauale SELLE koguga — sama žest kui
                  // märksõnal, mis viib märksõna-otsingusse.
                  setSelection({ kind: 'work_set', id: ws.id });
                  navigate('/');
                }}
                className="px-2.5 py-1 text-sm text-indigo-800 hover:bg-indigo-100 transition-colors"
              >
                {ws.name[keel] || ws.name.et || ws.name.en || ws.id}
                {ws.status === 'archived' && (
                  <span className="ml-1 text-xs text-indigo-400">({t('workSets.archived', 'Arhiveeritud')})</span>
                )}
              </button>
              {ws.can_manage && !readOnly && (
                <button
                  onClick={() => eemalda(ws.id)}
                  disabled={busy}
                  title={t('workSets.removeFromSet', 'Eemalda kogust')}
                  className="px-1.5 py-1 text-indigo-400 hover:text-rose-600 hover:bg-indigo-100 disabled:opacity-50"
                >
                  <X size={13} />
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {pickerOpen && (
        <WorkSetPicker
          isOpen={pickerOpen}
          onClose={() => setPickerOpen(false)}
          onSelect={lisa}
          busy={busy}
        />
      )}
    </div>
  );
};

export default WorkSetsPanel;
