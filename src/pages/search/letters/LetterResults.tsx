import React from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Mail } from 'lucide-react';
import type { LetterHit } from '../../../services/letterSearch';
import { useUser } from '../../../contexts/UserContext';
import { getLangCode } from '../../../utils/getLangCode';
import { partAbstract } from '../../manage/partsModel';
import { abstractSnippet, letterHeadline, letterPageExcerpts, splitMarks } from './letterDisplay';
import PageThumbnail from '../../../components/PageThumbnail';
import { letterThumbUrl } from './letterDisplay';

interface Props {
  hits: LetterHit[];
}

/** Pisipilte real; ülejäänu on „+N" (mahu kinnitus, mitte lugemiseks). */
const MAX_THUMBS = 8;

const Snippet: React.FC<{ text: string }> = ({ text }) => (
  <p className="text-sm text-gray-600">
    {splitMarks(text).map((p, i) => (p.mark
      ? <mark key={i} className="bg-yellow-100 text-gray-900 rounded-sm">{p.text}</mark>
      : <React.Fragment key={i}>{p.text}</React.Fragment>))}
  </p>
);

/** Lõik koos sildiga („lk 12" / „Regest"); sildita, kui lehte ei tea. */
interface Excerpt { key: string; label: string | null; page?: number; text: string; marked: boolean }

/** Üks rida = üks kiri; link avab kirja koodeksis (`?part=` avab osa sisukorras). */
const LetterResults: React.FC<Props> = ({ hits }) => {
  const { t, i18n } = useTranslation(['search', 'workspace']);
  const { authToken } = useUser();
  const lang = getLangCode(i18n.language);
  return (
    <ol className="divide-y divide-gray-100 rounded-lg border border-gray-200 bg-white">
      {hits.map(hit => {
        const to = `/work/${hit.work_id}/${hit.first_page}?part=${encodeURIComponent(hit.part_id)}`;
        const pageTo = (page: number) => `/work/${hit.work_id}/${page}?part=${encodeURIComponent(hit.part_id)}`;
        // Üks kuju igale reale: lehtede riba (maht) + sildiga lõigud (kus vaste on).
        // Kõik tuleb SAMAST kirjadokumendist — leht vaste asukohast, mitte teisest indeksist.
        const { excerpts: pageExcerpts, hitPages } = letterPageExcerpts(hit);
        const inAbstract = pageExcerpts.length ? null : abstractSnippet(hit);
        const summary = pageExcerpts.length || inAbstract ? null : partAbstract(hit, lang);
        const excerpts: Excerpt[] = pageExcerpts.length
          ? pageExcerpts.map((x, i) => (x.page != null
            ? { key: `p${x.page}`, label: t('letters.page', { page: x.page }), page: x.page, text: x.text, marked: true }
            : { key: `t${i}`, label: null, text: x.text, marked: true }))
          : inAbstract
            ? [{ key: 'a', label: t('letters.abstract'), text: inAbstract, marked: true }]
            : summary
              ? [{ key: 's', label: t('letters.abstract'), text: summary.otherLang
                ? `${summary.text} (${t(`workspace:manage.parts.${summary.otherLang === 'et' ? 'abstractInEt' : 'abstractInEn'}`)})`
                : summary.text, marked: false }]
              : [];
        const pages = [...(hit.pages ?? [])].sort((x, y) => x.n - y.n);
        return (
          <li key={hit.id} className="px-4 py-3">
            <Link to={to} className="group flex items-start gap-2">
              <Mail size={16} className="mt-0.5 shrink-0 text-primary-500" />
              <div className="min-w-0">
                <div className="font-semibold text-gray-900 group-hover:text-primary-700"
                  title={hit.dating?.source_text || undefined}>{letterHeadline(hit, t)}</div>
                <div className="text-xs text-gray-500">
                  {t('letters.inWork')} <span className="italic">{hit.work_title}</span>
                  {' · '}{t('letters.pages', { count: hit.page_count })}
                </div>
              </div>
            </Link>
            <div className="ml-6">
              {pages.length > 0 && (
                <div className="mt-2 flex items-end gap-1.5">
                  {pages.slice(0, MAX_THUMBS).map(p => (
                    <Link key={p.n} to={pageTo(p.n)} title={t('letters.page', { page: p.n })}
                      aria-label={t('letters.page', { page: p.n })}>
                      {/* Mitteavalik teos vajab allkirja; väljalogitul pole millegagi küsida. */}
                      <span className={`block h-16 w-12 overflow-hidden rounded-sm border bg-gray-100 hover:border-primary-400 ${
                        hitPages.includes(p.n) ? 'border-yellow-400 ring-2 ring-yellow-300' : 'border-gray-200'}`}>
                        <PageThumbnail workId={hit.work_id} src={letterThumbUrl(hit.work_id, p.img)}
                          restricted={hit.is_public === false && !!authToken}
                          className="h-full w-full object-cover" />
                      </span>
                    </Link>
                  ))}
                  {pages.length > MAX_THUMBS && (
                    <span className="pb-1 text-xs text-gray-500">+{pages.length - MAX_THUMBS}</span>
                  )}
                </div>
              )}
              {excerpts.length > 0 && (
                <ul className="mt-2 space-y-1">
                  {excerpts.map(x => (
                    <li key={x.key} className="flex items-baseline gap-2">
                      <span className="w-14 shrink-0 text-xs text-gray-500">
                        {x.page != null
                          ? <Link to={pageTo(x.page)} className="hover:text-primary-700 hover:underline">{x.label}</Link>
                          : x.label}
                      </span>
                      <div className={`min-w-0 ${x.marked ? '' : 'line-clamp-3'}`}>
                        {x.marked ? <Snippet text={x.text} /> : <p className="text-sm text-gray-700">{x.text}</p>}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
};

export default LetterResults;
