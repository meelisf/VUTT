import React from 'react';
import { useTranslation } from 'react-i18next';
import { groupCounts, type ItemGroupChange, type PageChanges } from './historyChanges';

/** Ajaloo rea lühikokkuvõte: mis kihid selles versioonis muutusid (#375). */
export const HistoryChangeBadges: React.FC<{ changes?: PageChanges }> = ({ changes }) => {
  const { t } = useTranslation(['workspace']);
  if (!changes) return null;
  const badges: string[] = [];
  if (changes.text) badges.push(t('history.changes.text'));
  const grupp = (key: 'text_annotations' | 'comments', label: string) => {
    const c = groupCounts(changes[key]);
    if (!c.added && !c.modified && !c.removed) return;
    const osad = [c.added && `+${c.added}`, c.modified && `~${c.modified}`, c.removed && `−${c.removed}`].filter(Boolean);
    badges.push(`${label} ${osad.join(' ')}`);
  };
  grupp('text_annotations', t('history.changes.annotations'));
  grupp('comments', t('history.changes.comments'));
  if (changes.page_tags) badges.push(t('history.changes.tags'));
  if (changes.status) badges.push(t('history.changes.status'));
  if (changes.other_fields?.length) badges.push(t('history.changes.other'));
  if (badges.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1 px-4 pb-2 pl-11 -mt-1">
      {badges.map(b => (
        <span key={b} className="text-[10px] px-1.5 py-0.5 rounded bg-gray-100 text-gray-600">{b}</span>
      ))}
    </div>
  );
};

const Grupp: React.FC<{ title: string; g?: ItemGroupChange }> = ({ title, g }) => {
  const { t } = useTranslation(['workspace']);
  if (!g) return null;
  return (
    <div className="mb-3 last:mb-0">
      <div className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1 border-b border-gray-100 pb-1">{title}</div>
      <ul className="space-y-1 text-xs">
        {g.added?.map(a => (
          <li key={`a-${a.id}`} className="bg-green-50 text-green-900 border-l-4 border-green-400 pl-2 py-0.5 whitespace-pre-wrap break-words">
            <span className="font-semibold">{t('history.changes.added')}:</span> {a.text}
          </li>
        ))}
        {g.modified?.map(m => (
          <li key={`m-${m.id}`} className="border-l-4 border-amber-300 pl-2 py-0.5 whitespace-pre-wrap break-words">
            <span className="font-semibold">{t('history.changes.modified')}:</span>{' '}
            <span className="bg-red-50 text-red-900 line-through decoration-red-300">{m.before}</span>{' → '}
            <span className="bg-green-50 text-green-900">{m.after}</span>
          </li>
        ))}
        {g.removed?.map(r => (
          <li key={`r-${r.id}`} className="bg-red-50 text-red-900 border-l-4 border-red-300 pl-2 py-0.5 whitespace-pre-wrap break-words">
            <span className="font-semibold">{t('history.changes.removed')}:</span> {r.text}
          </li>
        ))}
      </ul>
    </div>
  );
};

/** Lahtivõetud rea toimetajakihi muutused loetaval kujul (#375). */
export const HistoryChangeDetails: React.FC<{ changes?: PageChanges }> = ({ changes }) => {
  const { t } = useTranslation(['workspace', 'common']);
  if (!changes) return null;
  const { text_annotations, comments, page_tags, status, other_fields } = changes;
  if (!text_annotations && !comments && !page_tags && !status && !other_fields?.length) return null;
  return (
    <div className="bg-white rounded border border-gray-200 p-3 mb-3">
      <Grupp title={t('history.changes.annotations')} g={text_annotations} />
      <Grupp title={t('history.changes.comments')} g={comments} />
      {page_tags && (
        <div className="mb-3 last:mb-0 text-xs">
          <div className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1 border-b border-gray-100 pb-1">{t('history.changes.tags')}</div>
          {page_tags.added?.map(s => <span key={`+${s}`} className="inline-block mr-1 mb-1 px-1.5 py-0.5 rounded bg-green-50 text-green-900">+ {s}</span>)}
          {page_tags.removed?.map(s => <span key={`-${s}`} className="inline-block mr-1 mb-1 px-1.5 py-0.5 rounded bg-red-50 text-red-900">− {s}</span>)}
        </div>
      )}
      {status && (
        <div className="mb-3 last:mb-0 text-xs">
          <span className="font-semibold text-gray-500">{t('history.changes.status')}:</span>{' '}
          {status.before ? t(`common:status.${status.before}`, status.before) : '—'} → {status.after ? t(`common:status.${status.after}`, status.after) : '—'}
        </div>
      )}
      {!!other_fields?.length && (
        <div className="text-xs text-gray-500">
          {t('history.changes.otherFields', { fields: other_fields.join(', ') })}
        </div>
      )}
    </div>
  );
};
