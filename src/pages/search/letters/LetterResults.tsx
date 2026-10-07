import React from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Mail } from 'lucide-react';
import type { LetterHit } from '../../../services/letterSearch';
import { letterHeadline, letterSnippet, splitMarks } from './letterDisplay';

interface Props {
  hits: LetterHit[];
}

const Snippet: React.FC<{ text: string }> = ({ text }) => (
  <p className="mt-1 text-sm text-gray-600">
    {splitMarks(text).map((p, i) => (p.mark
      ? <mark key={i} className="bg-yellow-100 text-gray-900 rounded-sm px-0.5">{p.text}</mark>
      : <React.Fragment key={i}>{p.text}</React.Fragment>))}
  </p>
);

/** Üks rida = üks kiri; link avab kirja koodeksis (`?part=` avab osa sisukorras). */
const LetterResults: React.FC<Props> = ({ hits }) => {
  const { t } = useTranslation('search');
  return (
    <ol className="divide-y divide-gray-100 rounded-lg border border-gray-200 bg-white">
      {hits.map(hit => {
        const snippet = letterSnippet(hit);
        return (
          <li key={hit.id} className="px-4 py-3">
            <Link
              to={`/work/${hit.work_id}/${hit.first_page}?part=${encodeURIComponent(hit.part_id)}`}
              className="group flex items-start gap-2"
            >
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
            {snippet && <Snippet text={snippet} />}
          </li>
        );
      })}
    </ol>
  );
};

export default LetterResults;
