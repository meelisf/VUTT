/**
 * „ka: …” (ADR 0083 p 5): otsing tabas isiku teist nime, mitte kanoonilist —
 * näitame, millise nime järgi isik leiti. Muidu ei renderda midagi.
 */
import React from 'react';
import { useTranslation } from 'react-i18next';
import { matchedOtherName } from '../utils/personNames';

const AlsoKnownAs: React.FC<{
  person: Parameters<typeof matchedOtherName>[0];
  query?: string;
  className?: string;
}> = ({ person, query, className = 'text-xs text-gray-500' }) => {
  const { t } = useTranslation('prosopography');
  const hit = matchedOtherName(person, query);
  if (!hit) return null;
  return (
    <span className={className}>
      {t('names.also')} {hit.label}
      {hit.type && <> ({t(`names.types.${hit.type}`)})</>}
    </span>
  );
};

export default AlsoKnownAs;
