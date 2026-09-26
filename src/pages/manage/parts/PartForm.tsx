/**
 * Osa vorm (#464): isikud rollidega ESIMESENA (kirjal pealkirja enamasti pole —
 * kiri on „kellelt kellele"), siis liik, pealkiri, algus, aeg, koht (kirjal
 * kirjutamis- ja sihtkoht), lisa korral viide osale. Isikud käivad ühise
 * CreatorsEditori kaudu. Salvestamine ja kustutamine käivad PartsTab'is.
 */
import React from 'react';
import { useTranslation } from 'react-i18next';
import { AlertTriangle } from 'lucide-react';
import EntityPicker, { type PeopleRegisterEntry } from '../../../components/EntityPicker';
import WorkDatingInput from '../../../components/WorkDatingInput';
import CreatorsEditor from '../../../components/creators/CreatorsEditor';
import type { LinkedEntity } from '../../../types/LinkedEntity';
import { getLangCode } from '../../../utils/getLangCode';
import { PART_KINDS, PART_ROLES, type PartKind, type PartPlace, type WorkPart } from '../../../services/workPartsApi';
import type { PartDraft } from '../partsModel';

interface Props {
  isNew: boolean;
  draft: PartDraft;
  onDraft: (d: PartDraft) => void;
  otherParts: WorkPart[];         // „lisa osale" valikuks (lisad välja jäetud väljaspool)
  sharedStems: string[];
  error: string | null;
  busy: boolean;
  token: string | null;
  workId: string;
  authors: { label: string; id: string | null }[];
  peopleRegister: PeopleRegisterEntry[];
  onSave: () => void;
  onDelete: () => void;
}

const toEntity = (p: PartPlace | null): LinkedEntity | null =>
  p ? { id: p.id, label: p.label, source: p.id ? 'wikidata' : 'manual' } : null;
const fromEntity = (e: LinkedEntity | null): PartPlace | null => (e ? { id: e.id, label: e.label } : null);

const PartForm: React.FC<Props> = ({
  isNew, draft, onDraft, otherParts, sharedStems, error, busy, token, workId, authors, peopleRegister, onSave, onDelete,
}) => {
  const { t, i18n } = useTranslation(['workspace', 'common']);
  const lang = getLangCode(i18n.language);
  const set = (patch: Partial<PartDraft>) => onDraft({ ...draft, ...patch });
  const input = 'w-full rounded border border-gray-300 px-2 py-1.5 text-sm';
  const label = 'block text-xs font-bold uppercase text-gray-500';
  const roles = PART_ROLES.map(r => ({ id: r, label: t(`metadata.roles.${r}`) }));

  return (
    <div className="space-y-3">
      {sharedStems.map(stem => (
        <p key={stem} className="flex items-start gap-1.5 rounded bg-amber-50 px-2 py-1.5 text-xs text-amber-800">
          <AlertTriangle size={13} className="mt-0.5 shrink-0" />
          {t('manage.parts.sharedWarning', { stem })}
        </p>
      ))}

      <CreatorsEditor
        creators={draft.creators}
        onChange={creators => set({ creators })}
        roles={roles}
        newRole={draft.kind === 'letter' ? 'auctor' : 'participant'}
        lang={lang}
        token={token}
        workId={workId}
        suggestions={authors}
        peopleRegister={peopleRegister}
      />

      <div className="grid gap-3 sm:grid-cols-[10rem_minmax(0,1fr)]">
        <label className={label}>
          {t('manage.parts.kind')}
          <select className={`${input} mt-1 font-normal normal-case`} value={draft.kind} onChange={e => set({ kind: e.target.value as PartKind })}>
            {PART_KINDS.map(k => <option key={k} value={k}>{t(`manage.parts.kinds.${k}`)}</option>)}
          </select>
        </label>
        <label className={label}>
          {t('manage.parts.title')}
          <input className={`${input} mt-1 font-normal normal-case`} value={draft.title} onChange={e => set({ title: e.target.value })} />
        </label>
      </div>
      <label className={label}>
        {t('manage.parts.incipit')}
        <input className={`${input} mt-1 font-normal normal-case`} value={draft.incipit} onChange={e => set({ incipit: e.target.value })} />
      </label>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className={label}>
          {t('manage.parts.dating')}
          <div className="mt-1 font-normal normal-case">
            <WorkDatingInput value={draft.datingText} dating={draft.dating}
              onChange={(value, dating) => set({ datingText: value, dating })} />
          </div>
        </div>
        <div className={label}>
          {t(draft.kind === 'letter' ? 'manage.parts.placeLetter' : 'manage.parts.place')}
          <div className="mt-1 font-normal normal-case">
            <EntityPicker type="place" lang={lang} value={toEntity(draft.place)} onChange={e => set({ place: fromEntity(e) })} />
          </div>
        </div>
        {draft.kind === 'letter' && (
          <div className={`${label} sm:col-start-2`}>
            {t('manage.parts.placeTo')}
            <div className="mt-1 font-normal normal-case">
              <EntityPicker type="place" lang={lang} value={toEntity(draft.place_to)} onChange={e => set({ place_to: fromEntity(e) })} />
            </div>
          </div>
        )}
      </div>

      {draft.kind === 'attachment' && (
        <label className={label}>
          {t('manage.parts.attachedTo')}
          <select className={`${input} mt-1 font-normal normal-case`} value={draft.attached_to ?? ''} onChange={e => set({ attached_to: e.target.value || null })}>
            <option value="">{t('manage.parts.none')}</option>
            {otherParts.map(p => (
              <option key={p.id} value={p.id}>{p.title || t(`manage.parts.kinds.${p.kind}`)} ({p.id})</option>
            ))}
          </select>
        </label>
      )}

      <label className={label}>
        {t('manage.parts.notes')}
        <textarea className={`${input} mt-1 font-normal normal-case`} rows={2} value={draft.notes} onChange={e => set({ notes: e.target.value })} />
      </label>

      {error && <p className="text-sm text-red-600">{t('manage.parts.error', { message: error })}</p>}

      <div className="flex items-center gap-2 border-t border-gray-100 pt-3">
        <button type="button" disabled={busy} onClick={onSave}
          className="rounded bg-primary-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-primary-700 disabled:bg-gray-300">
          {t('manage.parts.save')}
        </button>
        {!isNew && (
          <button type="button" disabled={busy} onClick={onDelete}
            className="ml-auto rounded border border-red-300 px-3 py-1.5 text-sm text-red-700 hover:bg-red-50 disabled:opacity-50">
            {t('manage.parts.delete')}
          </button>
        )}
      </div>
    </div>
  );
};

export default PartForm;
