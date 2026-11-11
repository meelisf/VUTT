import React from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useParams } from 'react-router-dom';
import type { ArchiveRef, Exemplar } from '../../types';
import { exceptionPages, orderExemplars } from './exemplarCardUtils';
import { externalLinkLabel } from './exemplarSequences';

interface ExemplarCardsProps {
  /** Serverist laetud eksemplarid; `null` = veel laadimata või päring ebaõnnestus. */
  exemplars: Exemplar[] | null;
  pageNumbers: Record<string, number>;
  /** Meili `archive_refs` — kuvatakse seni, kuni eksemplarid pole kohal (ei vilgu). */
  archiveRefs: ArchiveRef[];
  archives: Record<string, { name: string; url?: string }>;
  /** Antud → hoidja nimi on link eksemplari lehele. */
  workId?: string;
  /** Eksemplari pildid (ADR 0079): `{eid: {count, preview}}` — kuvatakse ainult arv. */
  images?: Record<string, { count: number; preview: string[] }>;
}

const isHttpUrl = (url?: string) => !!url && /^https?:\/\//.test(url);

/**
 * Infopaneeli eksemplarid (ADR 0076), raamideta read. Transkriptsiooni alus on
 * esimene ja kannab rea lõpus pilli; teised on lühikirjed. Kaardil on ainult lühiinfo — pikem
 * (paber, vaatlused) kuulub eraldi vahekaardile.
 */
const ExemplarCards: React.FC<ExemplarCardsProps> = ({
  exemplars, pageNumbers, archiveRefs, archives, workId, images,
}) => {
  const { t } = useTranslation(['workspace']);
  // Töölaual avatud leht → eksemplari lehe tagasilink „Tagasi lehele N".
  const { pageNum } = useParams();
  const pageQuery = pageNum && /^\d+$/.test(pageNum) ? `?page=${pageNum}` : '';

  // Ühe kaardi rida: hoidja (+ nimi), kohaviit, välislink sildiga kiibina.
  const head = (holder: string, shelfmark?: string, url?: string, exemplarId?: string) => (
    <div className="min-w-0">
      {workId && exemplarId ? (
        <Link to={`/work/${workId}/exemplar/${exemplarId}${pageQuery}`} title={t('exemplarImages.open')}
          className="font-medium text-gray-800 hover:text-primary-700 hover:underline">{holder}</Link>
      ) : <span className="font-medium text-gray-800">{holder}</span>}
      {archives[holder]?.name && <span className="text-gray-500"> — {archives[holder].name}</span>}
      {shelfmark && <span className="ml-1">{shelfmark}</span>}
      {isHttpUrl(url) && (
        <a href={url} target="_blank" rel="noopener noreferrer" title={url}
          className="ml-1.5 text-[11px] leading-4 px-1.5 rounded-full border border-gray-300 text-primary-700 hover:text-primary-900 whitespace-nowrap">
          {externalLinkLabel(url!)} ↗
        </a>
      )}
    </div>
  );

  const row = 'flex items-start gap-2 text-sm text-gray-700';

  if (!exemplars) {
    // Laadimise ajal (või kui päring ebaõnnestus) tuletatud viited ilma pillita.
    return (
      <div className="space-y-1.5">
        {archiveRefs.map((ref, idx) => (
          <div key={idx} className={row}>{head(ref.archive_id, ref.reference, ref.url)}</div>
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
        const pics = images?.[x.id]?.count ?? 0;
        if (pics > 0) notes.push(t('exemplarImages.count', { count: pics }));
        return (
          <div key={x.id}>
          <div className={row}>
            {head(x.holder, x.shelfmark, x.url, x.id)}
            {notes.length > 0 && <span className="ml-auto shrink-0 text-xs text-gray-500 mt-0.5">{notes.join(' · ')}</span>}
            {x.text_witness && (
              <span className={`${notes.length > 0 ? '' : 'ml-auto '}shrink-0 mt-px text-[11px] leading-4 px-1.5 rounded-full border border-primary-300 text-primary-800`}>
                {t('exemplars.witness')}
              </span>
            )}
          </div>
          </div>
        );
      })}
    </div>
  );
};

export default ExemplarCards;
