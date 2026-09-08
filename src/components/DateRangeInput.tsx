import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { dateBound, parsePartialDate } from '../utils/workDating';

const fieldClass = 'min-w-0 w-full border border-gray-300 rounded px-2 py-1.5 text-sm bg-white';

export function DatePartsInput({ value, onChange, label, detailed, calendar }: {
  value: string; onChange: (value: string) => void; label: string; detailed: boolean; calendar?: string;
}) {
  const { t } = useTranslation('common');
  const [year = '', month = '', day = ''] = value.split('-');
  const set = (y: string, m: string, d: string) => onChange(y + (m ? `-${m}` : '') + (m && d ? `-${d.padStart(2, '0')}` : ''));
  const invalid = !!value && !parsePartialDate(value, calendar);
  return <fieldset className="min-w-0 space-y-1">
    <legend className="text-xs text-gray-500 mb-1">{label}</legend>
    <div className="flex flex-wrap gap-1">
      <input aria-label={`${label}: ${t('dating.year')}`} aria-invalid={invalid} type="text" inputMode="numeric" maxLength={4}
        className={`${fieldClass} !w-20`} placeholder={t('dating.year')} value={year}
        onChange={e => { if (/^\d{0,4}$/.test(e.target.value)) set(e.target.value, e.target.value ? month : '', e.target.value ? day : ''); }} />
      {detailed && <>
        <select aria-label={`${label}: ${t('dating.month')}`} className={`${fieldClass} !w-auto`} value={month} disabled={!year}
          onChange={e => set(year, e.target.value, '')}>
          <option value="">{t('dating.monthUnknown')}</option>
          {Array.from({ length: 12 }, (_, i) => <option key={i} value={String(i + 1).padStart(2, '0')}>{t(`dating.months.${i + 1}`)}</option>)}
        </select>
        <select aria-label={`${label}: ${t('dating.day')}`} aria-invalid={invalid}
          className={`${fieldClass} !w-auto`} value={day} disabled={!month}
          onChange={e => set(year, month, e.target.value)}>
          <option value="">{t('dating.day')}</option>
          {Array.from({ length: 31 }, (_, i) => <option key={i} value={String(i + 1).padStart(2, '0')}>{i + 1}</option>)}
        </select>
      </>}
    </div>
    {invalid && <p role="alert" className="text-xs text-red-600">{t('dating.invalid')}</p>}
  </fieldset>;
}

export default function DateRangeInput({ start, end, onStartChange, onEndChange }: {
  start: string; end: string; onStartChange: (value: string) => void; onEndChange: (value: string) => void;
}) {
  const { t } = useTranslation('common');
  const [expanded, setExpanded] = useState(start.includes('-') || end.includes('-'));
  const precise = start.includes('-') || end.includes('-');
  const summary = (value: string) => {
    const p = parsePartialDate(value);
    if (!p) return value;
    const [y, m, d] = p;
    return `${d ? `${d}${t('dating.daySuffix')} ` : ''}${m ? `${t(`dating.months.${m}`)} ` : ''}${y}`;
  };
  return <div className="space-y-1">
    <div className="flex flex-wrap gap-2">
      <DatePartsInput value={start} onChange={onStartChange} label={t('dating.from')} detailed={expanded} />
      <DatePartsInput value={end} onChange={onEndChange} label={t('dating.until')} detailed={expanded} />
    </div>
    <button type="button" aria-expanded={expanded} className="text-xs text-primary-600 hover:underline" onClick={() => setExpanded(!expanded)}>
      {t(expanded ? 'dating.collapse' : 'dating.refine')}
    </button>
    {!expanded && precise && <p className="text-xs text-gray-600">{summary(start)} – {summary(end)}</p>}
    {start && end && dateBound(start)! > dateBound(end, true)! && <p role="alert" className="text-xs text-red-600">{t('dating.reversed')}</p>}
    {expanded && <p className="text-xs text-gray-500">{t('dating.overlapHint')}</p>}
  </div>;
}
