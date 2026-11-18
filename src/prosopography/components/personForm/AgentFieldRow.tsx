import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { EnrichmentDate, EnrichmentItem } from '../../services/prosopographyService';
import { diffWords } from '../../../utils/textDiff';
import EvidenceList from '../EvidenceList';

interface Props {
  item: EnrichmentItem;
  titleOf: (workId: string) => string | undefined;
}

const dateText = (value?: Partial<EnrichmentDate> | null) => {
  if (!value?.date) return '';
  const [y, m, d] = value.date.split('-');
  const text = value.precision === 'day' && d ? `${+d}.${+m}.${y}` : value.precision === 'month' && m ? `${+m}.${y}` : y;
  return `${value.is_circa ? 'u ' : ''}${text}`;
};

/** Isikukaardi välja rida ülevaatuspaneelis (#834): sünd, surm, päritolu, sugu, elulugu.
 *  Olek ja praegune väärtus tulevad serverist — klient ei arvuta. */
export default function AgentFieldRow({ item, titleOf }: Props) {
  const { t } = useTranslation('prosopography');
  const tr = (key: string, options?: Record<string, unknown>) => t(`agentEnrichment.${key}`, options);
  const [showDiff, setShowDiff] = useState(false);
  const state = item.review_state?.state;
  const current = item.review_state?.current;

  const valueText = (): string => {
    switch (item.kind) {
      case 'birth': return dateText(item.date);
      case 'death': return [dateText(item.date), item.registry_labels?.place_key].filter(Boolean).join(', ');
      case 'origin': return item.registry_labels?.place_key || item.place_key || '';
      case 'gender': return item.value ? tr(`gender.${item.value}`) : '';
      default: return '';
    }
  };
  const currentText = (): string => {
    if (current == null) return '';
    if (item.kind === 'birth' || item.kind === 'death') {
      const c = current as Partial<EnrichmentDate> & { place?: { label?: string } | null };
      return [dateText(c), c.place?.label].filter(Boolean).join(', ');
    }
    if (item.kind === 'gender') return tr(`gender.${current as string}`);
    return String(current);
  };

  const badge = state === 'already_present' ? tr('badgePresent')
    : state === 'conflict' ? tr('badgeConflict') : state === 'replace' ? tr('badgeReplace') : tr('badgeField');
  const badgeCls = state === 'already_present' ? 'bg-amber-100 text-amber-800'
    : state === 'conflict' || state === 'replace' ? 'bg-orange-100 text-orange-800' : 'bg-sky-100 text-sky-800';
  const label = item.kind === 'biography' ? tr('kind.biography', { lang: item.lang }) : tr(`kind.${item.kind}`);

  return <div className="space-y-1">
    <p>
      <span className="text-gray-500 mr-1">{label}</span>
      {item.kind !== 'biography' && <strong>{valueText()}</strong>}
      <span className={`ml-2 inline-block rounded-full px-2 text-xs ${badgeCls}`}>{badge}</span>
    </p>
    {state === 'conflict' && <p className="text-xs text-gray-700">{tr('currentValue')}: {currentText()}</p>}
    {item.kind === 'biography' && <>
      <button type="button" className="text-xs text-blue-800 underline" onClick={() => setShowDiff(v => !v)}>
        {showDiff ? tr('hideDiff') : tr('showDiff')}
      </button>
      {showDiff && <div className="max-h-96 overflow-auto rounded border bg-gray-50 p-2 text-xs whitespace-pre-wrap">
        {diffWords(typeof current === 'string' ? current : '', item.text ?? '').map((o, i) => (
          <span key={i} className={o.op === 'ins' ? 'bg-green-100' : o.op === 'del' ? 'bg-red-100 line-through text-red-700' : ''}>
            {o.text}
          </span>))}
      </div>}
      {!!item.sources_add?.length && <div className="text-xs">
        <p className="text-gray-500">{tr('sourcesAdd')}</p>
        <ul className="list-disc pl-4 text-gray-700">
          {item.sources_add.map((s, i) => <li key={i}>
            {s.text ?? `${titleOf(s.work_id ?? '') ?? s.work_id}${s.page ? `, ${s.page}` : ''}`}
          </li>)}
        </ul>
      </div>}
    </>}
    {!!item.evidence?.length && <EvidenceList evidence={item.evidence} titleOf={titleOf} />}
  </div>;
}
