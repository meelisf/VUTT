/**
 * Teose lehe tagasinupp (#587 samm 4, makett variant D).
 *
 * Kogu kuuluvust põhivaates ei korrata (see on infopaneelis terve
 * hierarhiana) — nupp ütleb ainult, KUHU tagasi minnakse. Siht on
 * `vutt_return_url`, mille kirjutavad nimekirjad sirvimise ajal (filtrid ja
 * lehekülg kaasas). Lingiga tulles seda sessioonis ei ole ja nuppu ei näidata.
 */
import React from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowLeft, Bookmark } from 'lucide-react';
import { useSelectionLabel } from '../../hooks/useSelectionLabel';

export type BackTarget = 'list' | 'search' | null;

/** Tagasitee URL → mida nupul näidata. `null` = nuppu ei ole. */
export function backTarget(returnUrl: string | null): BackTarget {
  if (!returnUrl) return null;
  const path = returnUrl.split(/[?#]/)[0];
  if (path === '/search' || path.startsWith('/search/')) return 'search';
  if (path === '/' || path === '') return 'list';
  return null;
}

const WorkspaceBackButton: React.FC<{ returnUrl: string | null; onBack: () => void }> = ({ returnUrl, onBack }) => {
  const { t } = useTranslation(['workspace']);
  const { label, isWorkSet } = useSelectionLabel();
  const target = backTarget(returnUrl);
  if (!target) return null;

  // Nimekiri näitab aktiivset valikut — sama, mis päises ja kogu-ribal.
  const name = target === 'search' ? t('navigation.search') : label;
  const tone = isWorkSet && target === 'list'
    ? 'text-violet-700 bg-violet-50 hover:bg-violet-100'
    : 'text-primary-700 bg-primary-50 hover:bg-primary-100';

  return (
    <button
      type="button"
      onClick={onBack}
      className={`inline-flex items-center gap-1 pl-1.5 pr-2.5 py-1 rounded-md text-sm min-w-0 max-w-[18rem] transition-colors ${tone}`}
      title={t('navigation.backTo', { name })}
    >
      <ArrowLeft size={15} className="shrink-0" />
      {isWorkSet && target === 'list' && <Bookmark size={13} className="shrink-0" />}
      <span className="truncate">{name}</span>
    </button>
  );
};

export default WorkspaceBackButton;
