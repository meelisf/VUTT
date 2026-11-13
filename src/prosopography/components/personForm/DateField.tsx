import React, { useState, useEffect, useId } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronDown, ChevronRight } from 'lucide-react';
import type { DateDraft } from './types';
import EntityPicker from '../../../components/EntityPicker';

const DateField: React.FC<{
  label: string;
  value: DateDraft;
  onChange: (v: DateDraft) => void;
  lang?: string;
  localSuggestions?: { label: string; id: string }[];
  showPlace?: boolean;
  placeField?: React.ReactNode;
}> = ({ label, value, onChange, lang = 'et', localSuggestions, showPlace = true, placeField }) => {
  const { t } = useTranslation('prosopography');
  const set = (patch: Partial<DateDraft>) => onChange({ ...value, ...patch });
  const hasDetail = !!(value.circa || value.bound || value.calendar);
  const [open, setOpen] = useState(hasDetail);
  const detailsId = useId();
  useEffect(() => { if (hasDetail) setOpen(true); }, [hasDetail]);
  const inputCls = 'px-2 py-1.5 text-sm border border-gray-300 rounded focus:ring-1 focus:ring-primary-500 outline-none bg-white';

  return <div className="min-w-0 space-y-3">
    <fieldset>
      <legend className="block text-xs text-gray-600 uppercase tracking-wide mb-1">{label}</legend>
      <div className="flex flex-wrap gap-2">
        {(['year', 'month', 'day'] as const).map(field => <label key={field} className="block">
          <span className="block text-xs text-gray-500 mb-1">{t(`dateField.${field}`)}</span>
          <input type="number" min={field === 'year' ? 1000 : 1} max={field === 'year' ? 1900 : field === 'month' ? 12 : 31}
            aria-label={`${label}: ${t(`dateField.${field}`)}`} placeholder={field === 'year' ? '—' : ''}
            value={value[field]} onChange={e => set({ [field]: e.target.value })}
            className={`${field === 'year' ? 'w-24' : 'w-16'} ${inputCls}`} />
        </label>)}
      </div>
    </fieldset>
    {placeField}
    {showPlace && <EntityPicker label={t('dateField.place')} type="place" value={value.place}
      onChange={v => set({ place: v })} lang={lang} localSuggestions={localSuggestions} />}
    <div>
      <button type="button" aria-expanded={open} aria-controls={detailsId} onClick={() => setOpen(v => !v)}
        className="flex items-center gap-1 text-sm text-primary-700 hover:underline py-1">
        {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}{t('dateField.more')}
      </button>
      {open && <div id={detailsId} className="mt-2 p-3 bg-gray-50 rounded space-y-2">
        <label className="flex items-center gap-2 text-sm text-gray-700">
          <input type="checkbox" checked={value.circa} onChange={e => set({ circa: e.target.checked })} />
          {t('dateField.circa')}
        </label>
        <select aria-label={`${label}: ${t('dateField.bound')}`} value={value.bound}
          onChange={e => set({ bound: e.target.value as DateDraft['bound'] })} className={`w-full ${inputCls}`}>
          <option value="">{t('dateField.exactDate')}</option>
          <option value="before">{t('dateField.before')}</option>
          <option value="after">{t('dateField.after')}</option>
        </select>
        <select aria-label={`${label}: ${t('dateField.calendar')}`} value={value.calendar}
          onChange={e => set({ calendar: e.target.value as DateDraft['calendar'] })} className={`w-full ${inputCls}`}>
          <option value="">{t('dateField.noCalendar')}</option>
          <option value="julian">{t('dateField.julian')}</option>
          <option value="gregorian">{t('dateField.gregorian')}</option>
        </select>
      </div>}
    </div>
  </div>;
};
export default DateField;
