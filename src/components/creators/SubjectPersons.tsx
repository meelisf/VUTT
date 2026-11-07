/**
 * „Kelle kohta" (#743) — isikud, kellest või kellele tekst on, „Autorid ja
 * kaastöölised" all. Kirjed elavad teose `tags[]`-is; see komponent näitab ja
 * muudab ainult nende isikukirjeid, teemamärksõnad jäävad märksõnaväljale.
 * Lubatud on ainult isikuga seotav valik (VUTT-i register või välisallikas,
 * mille server salvestusel VUTT-i kaardiks teeb) — mitte vabatekstiline nimi.
 */
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { UserRound, X } from 'lucide-react';
import EntityPicker, { type PeopleRegisterEntry } from '../EntityPicker';
import { useNotify } from '../../contexts/FeedbackContext';
import { getLabel } from '../../utils/metadataUtils';
import type { LinkedEntity } from '../../types/LinkedEntity';
import { acceptSubjectPerson, isSubjectPerson } from './subjectPersons';

interface Props {
  tags: (string | LinkedEntity)[];
  onChange: (tags: (string | LinkedEntity)[]) => void;
  lang: string;
  token?: string | null;
  workId?: string | null;
  peopleRegister?: PeopleRegisterEntry[];
}

export default function SubjectPersons({ tags, onChange, lang, token, workId, peopleRegister }: Props) {
  const { t } = useTranslation(['workspace']);
  const notify = useNotify();
  const subjects = tags.filter((x): x is LinkedEntity => isSubjectPerson(x));

  const add = (val: LinkedEntity | null) => {
    if (!val) return;
    const entry = acceptSubjectPerson(val);
    if (!entry) {
      notify(t('metadata.subjectsNeedPerson'), 'warning');
      return;
    }
    if (tags.some(x => typeof x !== 'string' && x.id === entry.id)) return;
    onChange([...tags, entry]);
  };

  return (
    <div className="border-t border-gray-200 pt-3 space-y-2">
      <div>
        <h5 className="text-xs font-bold text-gray-600 uppercase">{t('metadata.subjects')}</h5>
        <p className="text-xs text-gray-500 mt-0.5">{t('metadata.subjectsHint')}</p>
      </div>
      {subjects.length === 0 ? (
        <p className="text-xs text-gray-400 italic">{t('metadata.noSubjects')}</p>
      ) : (
        <div className="flex flex-wrap gap-2">
          {subjects.map(s => (
            <span key={s.id} className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs border bg-primary-50 border-primary-200 text-primary-700">
              {getLabel(s, lang)}
              {s.id?.startsWith('vutt:P') && (
                <Link to={`/persons/${s.id}`} target="_blank" rel="noopener noreferrer"
                  className="opacity-50 hover:opacity-100" title={t('metadata.viewPersonPage')}>
                  <UserRound size={10} />
                </Link>
              )}
              <button type="button" className="hover:text-red-500"
                aria-label={t('metadata.removeCreator')}
                onClick={() => onChange(tags.filter(x => x !== s))}>
                <X size={12} />
              </button>
            </span>
          ))}
        </div>
      )}
      <EntityPicker
        type="person"
        value={null}
        alreadySelected={subjects}
        onChange={add}
        placeholder={t('metadata.addSubject')}
        lang={lang}
        peopleRegister={peopleRegister}
        showPersonToggle
        defaultPersonSearch
        token={token ?? undefined}
        personContext={workId ? { work_id: workId, role: 'subject' } : undefined}
      />
    </div>
  );
}
