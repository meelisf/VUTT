import React from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Mail } from 'lucide-react';
import type { LetterHit } from '../../../services/letterSearch';
import { useUser } from '../../../contexts/UserContext';
import { getLangCode } from '../../../utils/getLangCode';
import { partAbstract } from '../../manage/partsModel';
import { letterHeadline, letterSnippet, splitMarks } from './letterDisplay';
import { useLetterPreviews } from './useLetterPreviews';

interface Props {
  hits: LetterHit[];
  query: string;
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
const LetterResults: React.FC<Props> = ({ hits, query }) => {
  const { t, i18n } = useTranslation(['search', 'workspace']);
  const { authToken } = useUser();
  const previews = useLetterPreviews(hits, query, authToken);
  const lang = getLangCode(i18n.language);
  return (
    <ol className="divide-y divide-gray-100 rounded-lg border border-gray-200 bg-white">
      {hits.map(hit => {
        const to = `/work/${hit.work_id}/${hit.first_page}?part=${encodeURIComponent(hit.part_id)}`;
        const pageTo = (page: number) => `/work/${hit.work_id}/${page}?part=${encodeURIComponent(hit.part_id)}`;
        const preview = previews.get(hit.id);
        const pageHits = preview?.pageHits ?? [];
        const hitPages = new Set(pageHits.map(h => h.page));
        // Üks kuju igale reale: lehtede riba (maht) + sildiga lõigud (kus vaste on).
        // Tabatud lehed võidavad kirja-tasandi lõigu; see jääb, kui tabas regest
        // või kirja tekst, mille lehte lehtede indeks ei leidnud.
        const letterLevel = pageHits.length ? null : letterSnippet(hit);
        const summary = !pageHits.length && !letterLevel && preview ? partAbstract(preview.part, lang) : null;
        const excerpts: Excerpt[] = pageHits.length
          ? pageHits.map(h => ({ key: `p${h.page}`, label: t('letters.page', { page: h.page }), page: h.page, text: h.snippet, marked: true }))
          : letterLevel
            ? [{ key: 'l', label: letterLevel.source === 'abstract' ? t('letters.abstract') : null, text: letterLevel.text, marked: true }]
            : summary
              ? [{ key: 's', label: t('letters.abstract'), text: summary.otherLang
                ? `${summary.text} (${t(`workspace:manage.parts.${summary.otherLang === 'et' ? 'abstractInEt' : 'abstractInEn'}`)})`
                : summary.text, marked: false }]
              : [];
        const pages = preview?.pages ?? [];
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
                    <Link key={p.page} to={pageTo(p.page)} title={t('letters.page', { page: p.page })}
                      aria-label={t('letters.page', { page: p.page })}>
                      <img src={p.thumb} alt="" loading="lazy"
                        className={`h-16 w-12 rounded-sm border bg-gray-100 object-cover hover:border-primary-400 ${
                          hitPages.has(p.page) ? 'border-yellow-400 ring-2 ring-yellow-300' : 'border-gray-200'}`}
                        onError={e => { e.currentTarget.style.display = 'none'; }} />
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
