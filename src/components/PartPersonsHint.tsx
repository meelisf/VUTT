import React from 'react';
import { useTranslation } from 'react-i18next';

/** „Sisukorras: X" — teos leiti osa isiku järgi, mitte pealkirja ega teose isiku järgi (ADR 0072). */
const PartPersonsHint: React.FC<{ names?: string[]; className?: string }> = ({ names, className = '' }) => {
  const { t } = useTranslation(['dashboard']);
  if (!names?.length) return null;
  const shown = names.slice(0, 2).join(', ') + (names.length > 2 ? ` +${names.length - 2}` : '');
  return <p className={`text-xs text-gray-500 ${className}`}>{t('workCard.inContents', { names: shown })}</p>;
};

export default PartPersonsHint;
