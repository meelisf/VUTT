import React from 'react';
import { useTranslation } from 'react-i18next';
import type { ArchiveRef, Exemplar } from '../../types';
import { exceptionPages, orderExemplars } from './exemplarCardUtils';

interface ExemplarCardsProps {
  /** Serverist laetud eksemplarid; `null` = veel laadimata või päring ebaõnnestus. */
  exemplars: Exemplar[] | null;
  pageNumbers: Record<string, number>;
  /** Meili `archive_refs` — kuvatakse seni, kuni eksemplarid pole kohal (ei vilgu). */
  archiveRefs: ArchiveRef[];
  archives: Record<string, { name: string; url?: string }>;
}

const isHttpUrl = (url?: string) => !!url && /^https?:\/\//.test(url);

/**
 * Infopaneeli eksemplarikaardid (ADR 0076). Transkriptsiooni alus on esimene ja
 * esile tõstetud; teised on lühikirjed. Kaardil on ainult lühiinfo — pikem
 * (paber, vaatlused) kuulub eraldi vahekaardile.
 */
const ExemplarCards: React.FC<ExemplarCardsProps> = ({ exemplars, pageNumbers, archiveRefs, archives }) => {
  const { t } = useTranslation(['workspace']);

  // Ühe kaardi rida: hoidja (+ nimi), kohaviit, link.
  const head = (holder: string, shelfmark?: string, url?: string) => (
    <div className="min-w-0">
      <span className="font-medium text-gray-800">{holder}</span>
      {archives[holder]?.name && <span className="text-gray-500"> — {archives[holder].name}</span>}
      {shelfmark && <span className="ml-1">{shelfmark}</span>}
      {isHttpUrl(url) && (
        <a href={url} target="_blank" rel="noopener noreferrer" className="ml-1 text-primary-600 hover:text-primary-800" title={url}>↗</a>
      )}
    </div>
  );

  const plain = 'rounded border border-gray-200 px-2.5 py-1.5 text-sm text-gray-700';

  if (!exemplars) {
    // Laadimise ajal (või kui päring ebaõnnestus) tuletatud viited ilma esiletõstuta.
    return (
      <div className="space-y-1.5">
        {archiveRefs.map((ref, idx) => (
          <div key={idx} className={plain}>{head(ref.archive_id, ref.reference, ref.url)}</div>
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-1.5" data-testid="exemplar-cards">
      {orderExemplars(exemplars).filter(x => x.holder).map(x => {
        const notes: string[] = [];
        const pages = exceptionPages(x, pageNumbers);
        if (pages) notes.push(t('info.exemplarPages', { pages }));
        if (x.reproduction) notes.push(t(`exemplars.reproduction.kinds.${x.reproduction.kind}`));
        if (x.text_witness) {
          return (
            <div key={x.id} className="rounded border-2 border-primary-300 bg-primary-50/60 px-2.5 py-1.5 text-sm text-gray-700">
              <div className="flex items-start gap-2">
                {head(x.holder, x.shelfmark, x.url)}
                <span className="ml-auto shrink-0 text-[11px] px-1.5 py-0.5 rounded-full border border-primary-300 text-primary-800 bg-white">
                  {t('exemplars.witness')}
                </span>
              </div>
              {notes.length > 0 && <div className="text-xs text-gray-500 mt-0.5">{notes.join(' · ')}</div>}
            </div>
          );
        }
        return (
          <div key={x.id} className={`${plain} flex items-start gap-2`}>
            {head(x.holder, x.shelfmark, x.url)}
            {notes.length > 0 && <span className="ml-auto shrink-0 text-xs text-gray-500">{notes.join(' · ')}</span>}
          </div>
        );
      })}
    </div>
  );
};

export default ExemplarCards;
