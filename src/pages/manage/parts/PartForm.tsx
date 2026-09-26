/**
 * Osa vorm (#464): liik, pealkiri, algus, aeg, koht (kirjal kirjutamis- ja sihtkoht),
 * isikud rollidega, lisa korral viide osale. Salvestamine ja kustutamine käivad
 * PartsTab'is; siin on ainult mustandi redigeerimine.
 */
import React from 'react';
import { useTranslation } from 'react-i18next';
import { Plus, Trash2, AlertTriangle } from 'lucide-react';
import EntityPicker from '../../../components/EntityPicker';
import WorkDatingInput from '../../../components/WorkDatingInput';
import type { LinkedEntity } from '../../../types/LinkedEntity';
import { PART_KINDS, PART_ROLES, type PartKind, type PartPlace, type PartRole, type WorkPart } from '../../../services/workPartsApi';
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
  onSave: () => void;
  onDelete: () => void;
}

const toEntity = (p: PartPlace | null): LinkedEntity | null =>
  p ? { id: p.id, label: p.label, source: p.id ? 'wikidata' : 'manual' } : null;
const fromEntity = (e: LinkedEntity | null): PartPlace | null => (e ? { id: e.id, label: e.label } : null);

const PartForm: React.FC<Props> = ({ isNew, draft, onDraft, otherParts, sharedStems, error, busy, token, onSave, onDelete }) => {
  const { t } = useTranslation(['workspace', 'common']);
  const set = (patch: Partial<PartDraft>) => onDraft({ ...draft, ...patch });
  const input = 'w-full rounded border border-gray-300 px-2 py-1.5 text-sm';

  return (
    <div className="space-y-3 rounded-lg border border-gray-200 bg-white p-4">
      <h3 className="font-semibold text-gray-800">
        {isNew ? t('manage.parts.newPart') : draft.title || t(`manage.parts.kinds.${draft.kind}`)}
      </h3>

      {sharedStems.map(stem => (
        <p key={stem} className="flex items-start gap-1.5 rounded bg-amber-50 px-2 py-1.5 text-xs text-amber-800">
          <AlertTriangle size={13} className="mt-0.5 shrink-0" />
          {t('manage.parts.sharedWarning', { stem })}
        </p>
      ))}

      <label className="block text-xs text-gray-600">
        {t('manage.parts.kind')}
        <select className={input} value={draft.kind} onChange={e => set({ kind: e.target.value as PartKind })}>
          {PART_KINDS.map(k => <option key={k} value={k}>{t(`manage.parts.kinds.${k}`)}</option>)}
        </select>
      </label>
      <label className="block text-xs text-gray-600">
        {t('manage.parts.title')}
        <input className={input} value={draft.title} onChange={e => set({ title: e.target.value })} />
      </label>
      <label className="block text-xs text-gray-600">
        {t('manage.parts.incipit')}
        <input className={input} value={draft.incipit} onChange={e => set({ incipit: e.target.value })} />
      </label>
      <div className="text-xs text-gray-600">
        {t('manage.parts.dating')}
        <WorkDatingInput value={draft.datingText} dating={draft.dating}
          onChange={(value, dating) => set({ datingText: value, dating })} />
      </div>
      <div className="text-xs text-gray-600">
        {t(draft.kind === 'letter' ? 'manage.parts.placeLetter' : 'manage.parts.place')}
        <EntityPicker type="place" value={toEntity(draft.place)} onChange={e => set({ place: fromEntity(e) })} />
      </div>
      {draft.kind === 'letter' && (
        <div className="text-xs text-gray-600">
          {t('manage.parts.placeTo')}
          <EntityPicker type="place" value={toEntity(draft.place_to)} onChange={e => set({ place_to: fromEntity(e) })} />
        </div>
      )}

      <div className="space-y-2">
        <div className="text-xs text-gray-600">{t('manage.parts.persons')}</div>
        {draft.creators.map((c, i) => (
          <div key={i} className="flex items-start gap-2">
            <div className="min-w-0 flex-1">
              <EntityPicker
                type="person"
                showPersonToggle
                defaultPersonSearch
                token={token ?? undefined}
                value={c.name ? { id: c.id ?? null, label: c.name, source: 'local', entity_type: 'person' } : null}
                onChange={e => {
                  const next = [...draft.creators];
                  next[i] = { ...c, id: e?.id ?? undefined, name: e?.label ?? undefined, source: e?.source };
                  set({ creators: next });
                }}
              />
            </div>
            <select
              aria-label={t('manage.parts.role')}
              className="rounded border border-gray-300 px-1.5 py-1.5 text-sm"
              value={c.role}
              onChange={e => {
                const next = [...draft.creators];
                next[i] = { ...c, role: e.target.value as PartRole };
                set({ creators: next });
              }}
            >
              {PART_ROLES.map(r => <option key={r} value={r}>{t(`metadata.roles.${r}`)}</option>)}
            </select>
            <button type="button" aria-label={t('common:buttons.remove')} className="p-1.5 text-gray-400 hover:text-red-600"
              onClick={() => set({ creators: draft.creators.filter((_, j) => j !== i) })}>
              <Trash2 size={14} />
            </button>
          </div>
        ))}
        <button type="button" className="flex items-center gap-1 text-xs text-primary-700 hover:underline"
          onClick={() => set({ creators: [...draft.creators, { role: draft.kind === 'letter' ? 'auctor' : 'participant' }] })}>
          <Plus size={12} /> {t('manage.parts.addPerson')}
        </button>
      </div>

      {draft.kind === 'attachment' && (
        <label className="block text-xs text-gray-600">
          {t('manage.parts.attachedTo')}
          <select className={input} value={draft.attached_to ?? ''} onChange={e => set({ attached_to: e.target.value || null })}>
            <option value="">{t('manage.parts.none')}</option>
            {otherParts.map(p => (
              <option key={p.id} value={p.id}>{p.title || t(`manage.parts.kinds.${p.kind}`)} ({p.id})</option>
            ))}
          </select>
        </label>
      )}

      <label className="block text-xs text-gray-600">
        {t('manage.parts.notes')}
        <textarea className={input} rows={2} value={draft.notes} onChange={e => set({ notes: e.target.value })} />
      </label>

      {error && <p className="text-sm text-red-600">{t('manage.parts.error', { message: error })}</p>}

      <div className="flex items-center gap-2">
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
