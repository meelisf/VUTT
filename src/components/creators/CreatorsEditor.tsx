/**
 * Isikud rollidega — ÜKS komponent kõigile isikulisamise vormidele (MetadataModal,
 * UploadMetaForm, teose osad #464). EntityPicker saab alati täisvarustuse: isikute
 * register, kohalikud soovitused, keel, token ja teose kontekst isikupaneelile.
 * Rollide loend tuleb kutsujalt (teosel vocabularies.roles, osal PART_ROLES).
 */
import { useTranslation } from 'react-i18next';
import { Plus, Trash2 } from 'lucide-react';
import EntityPicker, { type PeopleRegisterEntry } from '../EntityPicker';
import { creatorFromPicker, creatorToPickerValue, type CreatorLike } from './creatorEntity';

export interface RoleOption { id: string; label: string }
interface SuggestionItem { label: string; id: string | null }

interface Props<C extends CreatorLike> {
  creators: C[];
  onChange: (next: C[]) => void;
  roles: RoleOption[];
  /** „Lisa isik" uue rea roll. */
  newRole: string;
  lang: string;
  token?: string | null;
  /** Olemas ainult siis, kui teos on olemas — muidu isikupaneelile konteksti ei anta. */
  workId?: string | null;
  suggestions?: SuggestionItem[];
  peopleRegister?: PeopleRegisterEntry[];
  className?: string;
}

function CreatorsEditor<C extends CreatorLike>({
  creators, onChange, roles, newRole, lang, token, workId, suggestions, peopleRegister,
  className = 'bg-gray-50/50',
}: Props<C>) {
  const { t } = useTranslation(['workspace']);
  const replace = (i: number, c: C) => onChange(creators.map((x, j) => (j === i ? c : x)));

  return (
    <div className={`border border-gray-200 rounded-lg p-3 space-y-3 ${className}`}>
      <div className="flex justify-between items-center -mt-1">
        <h4 className="text-xs font-bold text-gray-600 uppercase">{t('metadata.creators')}</h4>
        <button
          type="button"
          onClick={() => onChange([...creators, { name: '', role: newRole } as C])}
          className="text-xs text-primary-600 hover:text-primary-700 flex items-center gap-1"
        >
          <Plus size={14} />
          {t('metadata.addCreator')}
        </button>
      </div>
      {creators.length === 0 ? (
        <p className="text-xs text-gray-400 italic">{t('metadata.noCreators')}</p>
      ) : (
        <div className="space-y-2">
          {creators.map((creator, i) => (
            <div key={i} className="flex gap-2 items-start">
              <div className="flex-1 min-w-0">
                <EntityPicker
                  type="person"
                  value={creatorToPickerValue(creator)}
                  onChange={val => replace(i, creatorFromPicker(creator, val))}
                  placeholder={t('metadata.creatorName')}
                  lang={lang}
                  localSuggestions={suggestions}
                  peopleRegister={peopleRegister}
                  showPersonToggle
                  defaultPersonSearch
                  token={token ?? undefined}
                  personContext={workId ? { work_id: workId, role: creator.role } : undefined}
                />
              </div>
              <select
                aria-label={t('manage.parts.role')}
                className="border border-gray-300 rounded px-2 py-[7px] text-sm focus:ring-2 focus:ring-primary-500 outline-none bg-white w-36"
                value={creator.role}
                onChange={e => replace(i, { ...creator, role: e.target.value })}
              >
                {roles.map(r => <option key={r.id} value={r.id}>{r.label}</option>)}
                {/* Loendiväline roll (vana kirje) jääb nähtavaks, mitte vaikselt esimeseks */}
                {!roles.some(r => r.id === creator.role) && (
                  <option value={creator.role}>{t(`metadata.roles.${creator.role}`, creator.role)}</option>
                )}
              </select>
              <button
                type="button"
                onClick={() => onChange(creators.filter((_, j) => j !== i))}
                className="p-1.5 text-gray-400 hover:text-red-500 transition-colors"
                title={t('metadata.removeCreator')}
                aria-label={t('metadata.removeCreator')}
              >
                <Trash2 size={16} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default CreatorsEditor;
