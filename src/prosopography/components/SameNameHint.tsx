/**
 * Samanimeliste isikute vihje (ADR 0082 p 4). Kõigile näitab samanimelisi koos
 * eristava reaga; toimetajale lisaks palve lisada täiend, kui see puudub.
 */
import React from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Users } from 'lucide-react';
import type { ProsopoIndexEntry } from '../types';
import { distinguishingText } from '../utils/distinguishing';

interface Props {
  matches: ProsopoIndexEntry[];
  /** Kas selle isiku täiend on juba olemas. */
  hasQualifier: boolean;
  /** Toimetaja näeb palvet täiend lisada. */
  canEdit: boolean;
}

const SameNameHint: React.FC<Props> = ({ matches, hasQualifier, canEdit }) => {
  const { t } = useTranslation(['prosopography']);
  if (matches.length === 0) return null;
  const ask = canEdit && !hasQualifier;
  return (
    <div className={`rounded border px-3 py-2 text-sm ${ask ? 'border-amber-200 bg-amber-50/60' : 'border-gray-200 bg-gray-50'}`}>
      <div className={`flex items-center gap-1.5 text-xs font-medium ${ask ? 'text-amber-800' : 'text-gray-600'}`}>
        <Users size={13} />
        {t('sameName.title', { count: matches.length })}
      </div>
      <ul className="mt-1 space-y-0.5">
        {matches.map(p => (
          <li key={p.id}>
            <Link to={`/persons/${p.id}`} className="text-primary-700 hover:underline">{p.label}</Link>
            {distinguishingText(p) && <span className="ml-1.5 text-xs text-gray-500">{distinguishingText(p)}</span>}
          </li>
        ))}
      </ul>
      {ask && <p className="mt-1 text-xs text-amber-800">{t('sameName.addQualifier')}</p>}
    </div>
  );
};

export default SameNameHint;
