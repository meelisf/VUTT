import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { DatePartsInput } from './DateRangeInput';
import { datingError, datingText, parseDatingText, WorkDating } from '../utils/workDating';
import { formatYearDisplay, parseYearDisplayRange } from '../utils/yearDisplayUtils';

export default function WorkDatingInput({ value, dating, onChange }: {
  value: string; dating?: WorkDating | null; onChange: (value: string, dating: WorkDating | null) => void;
}) {
  const { t } = useTranslation('common');
  const inferred = dating ?? parseDatingText(value);
  const [expandedOverride, setExpanded] = useState<boolean | null>(null);
  const expanded = expandedOverride ?? (!!inferred && (!!inferred.end || inferred.start.includes('-') || !!dating));
  const current = inferred ?? { start: '' };
  const set = (patch: Partial<WorkDating>) => {
    const next = { ...current, ...patch };
    if (!dating && value.trim()) next.source_text = value;
    onChange(datingText(next), next);
  };
  return <div className="space-y-2">
    <div className="flex items-center justify-between gap-2">
      <span className="text-xs font-medium text-gray-500">{t('dating.label')}</span>
      <button type="button" aria-expanded={expanded} className="text-xs text-primary-600 hover:underline" onClick={() => setExpanded(!expanded)}>{t(expanded ? 'dating.collapse' : 'dating.refine')}</button>
    </div>
    {!expanded && dating ? <p className="text-sm">{formatYearDisplay(value, null, t, dating)}</p> : !expanded ? <input aria-label={t('dating.label')} className="w-full border border-gray-300 rounded px-3 py-2 text-sm" value={value}
      placeholder="1803, ca. 1803, 1803–1804" onChange={e => onChange(e.target.value, null)} /> : <>
      {!inferred && value && <p className="text-xs text-gray-500">{t('dating.source')}: {value}</p>}
      <DatePartsInput label={t('dating.start')} value={current.start} onChange={start => set({ start })} detailed calendar={current.calendar} unknownMonth />
      {current.end !== undefined ? <div className="space-y-1">
        <DatePartsInput label={t('dating.end')} value={current.end} onChange={end => set({ end })} detailed calendar={current.calendar} unknownMonth />
        <button type="button" className="text-xs text-primary-600" onClick={() => set({ end: undefined, kind: undefined })}>{t('dating.removeEnd')}</button>
      </div> : <button type="button" className="text-xs text-primary-600 hover:underline" onClick={() => set({ end: '' })}>{t('dating.addEnd')}</button>}
      <details className="text-sm" open={current.calendar || current.approximate || current.note || current.kind ? true : undefined}>
        <summary className="cursor-pointer text-xs text-gray-500">{t('dating.more')}</summary>
        <div className="space-y-2 mt-2">
          <label className="block">{t('dating.calendar')} <select className="border rounded p-1" value={current.calendar ?? ''} onChange={e => set({ calendar: (e.target.value || undefined) as WorkDating['calendar'] })}>
            <option value="">{t('dating.calendarUnknown')}</option>
            {['julian', 'gregorian', 'swedish'].map(c => <option key={c} value={c}>{t(`dating.${c}`)}</option>)}
          </select></label>
          <label className="flex items-center gap-2"><input type="checkbox" checked={!!current.approximate} onChange={e => set({ approximate: e.target.checked })} />{t('dating.approximate')}</label>
          {current.end !== undefined && <label className="block">{t('dating.kind')} <select className="border rounded p-1" value={current.kind ?? ''} onChange={e => set({ kind: (e.target.value || undefined) as WorkDating['kind'] })}>
            <option value="">{t('dating.unspecified')}</option><option value="span">{t('dating.span')}</option><option value="uncertain">{t('dating.uncertain')}</option>
          </select></label>}
          <label className="block">{t('dating.note')}<textarea className="w-full border rounded p-2" value={current.note ?? ''} onChange={e => set({ note: e.target.value })} /></label>
          {current.source_text && <p className="text-xs text-gray-500">{t('dating.source')}: {current.source_text}</p>}
        </div>
      </details>
    </>}
    {value && <button type="button" className="text-xs text-gray-500 hover:underline" onClick={() => onChange('', null)}>{t('dating.clear')}</button>}
    {datingError(dating) ? <p role="alert" className="text-xs text-red-600">{t('dating.invalid')}</p> :
      (expanded || !dating) && <p className="text-sm text-gray-600">{formatYearDisplay(value, null, t, dating)}</p>}
    {value && !dating && !parseYearDisplayRange(null, value) && <p className="text-xs text-amber-600">{t('dating.unparsed')}</p>}
  </div>;
}
