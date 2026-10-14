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
import { Bookmark, X, Plus, Loader2 } from 'lucide-react';
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
  const { workSets, workSetsError, refreshWorkSets, setSelection } = useCollection();
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
  // ERAND: kogude loendi RIKE ei tohi paneeli peita — muidu näeb kasutaja
  // ainult kadunud nuppu ja mitte ühtki põhjust (#354).
  if (!workId) return null;
  if (kuuluvus === null) return null;
  if (kuuluvus.length === 0 && (!managesAny || readOnly) && !workSetsError) return null;

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
          <Bookmark size={18} className="text-violet-600" />
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
      {/* Kogude loend ei laadinud: „Lisa" nupp puudub PÕHJUSEGA, mitte vaikselt. */}
      {workSetsError && !readOnly && (
        <p className="text-sm text-amber-700 mb-2 flex items-center gap-2">
          {t('workSets.loadFailed', 'Töökollektsioonide laadimine ebaõnnestus')}
          <button
            onClick={() => refreshWorkSets()}
            className="underline hover:no-underline"
          >
            {t('workSets.retry', 'Proovi uuesti')}
          </button>
        </p>
      )}

      {kuuluvus.length === 0 ? (
        <p className="text-sm text-gray-400">{t('workSets.notInAny', 'Teos ei kuulu ühtegi töökollektsiooni')}</p>
      ) : (
        // Loend, mitte kiibid (#587): indigo-kiip meenutas märksõna või žanrit,
        // kuigi kogu ei ole teose sisu omadus. Arv tuleb kogude loendi `count`-ist
        // (kutsujale otsingus nähtavad liikmed), mitte `for-work` vastusest.
        <ul className="divide-y divide-gray-100">
          {kuuluvus.map(ws => {
            const count = workSets.find(w => w.id === ws.id)?.count;
            return (
              <li key={ws.id} className="flex items-center gap-2.5 py-2">
                <Bookmark size={15} className="text-violet-600 shrink-0" />
                <button
                  onClick={() => {
                    // Kogule klõps viib töölauale SELLE koguga — sama žest kui
                    // märksõnal, mis viib märksõna-otsingusse.
                    setSelection({ kind: 'work_set', id: ws.id });
                    navigate('/');
                  }}
                  className="min-w-0 truncate text-left text-sm font-medium text-gray-800 hover:text-violet-700 hover:underline underline-offset-2"
                >
                  {ws.name[keel] || ws.name.et || ws.name.en || ws.id}
                </button>
                {ws.visibility === 'members' && (
                  <span className="shrink-0 text-[11px] text-gray-500 border border-gray-200 rounded px-1.5">
                    {t('workSets.private')}
                  </span>
                )}
                {ws.status === 'archived' && (
                  <span className="shrink-0 text-xs text-gray-400">({t('workSets.archived', 'Arhiveeritud')})</span>
                )}
                {count !== undefined && (
                  <span className="shrink-0 text-xs text-gray-400 tabular-nums">{t('workSets.workCount', { count })}</span>
                )}
                {ws.can_manage && !readOnly && (
                  <button
                    onClick={() => eemalda(ws.id)}
                    disabled={busy}
                    title={t('workSets.removeFromSet', 'Eemalda kogust')}
                    className="ml-auto shrink-0 inline-flex items-center gap-1 text-xs text-gray-400 hover:text-rose-600 disabled:opacity-50"
                  >
                    <X size={13} />
                    <span className="hidden sm:inline">{t('workSets.remove')}</span>
                  </button>
                )}
              </li>
            );
          })}
        </ul>
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
