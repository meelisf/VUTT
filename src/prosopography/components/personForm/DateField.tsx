import React, { useState, useEffect } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import type { DateDraft } from './types';
import EntityPicker from '../../../components/EntityPicker';

const DateField: React.FC<{
  label: string;
  value: DateDraft;
  onChange: (v: DateDraft) => void;
  lang?: string;
}> = ({ label, value, onChange, lang = 'et' }) => {
  const set = (patch: Partial<DateDraft>) => onChange({ ...value, ...patch });

  const hasDetail = !!(value.month || value.day || value.circa || value.bound || value.calendar || value.place);
  const [open, setOpen] = useState(hasDetail);
  // Ava automaatselt kui rikastamine lisab koha/täpsuse väljalt
  useEffect(() => { if (hasDetail) setOpen(true); }, [hasDetail]);

  const summary = (() => {
    const parts: string[] = [];
    if (value.circa) parts.push('~');
    if (value.bound === 'before') parts.push('enne');
    if (value.bound === 'after') parts.push('pärast');
    if (value.month) parts.push(value.day ? `${value.day}.${value.month}` : `kuu ${value.month}`);
    if (value.calendar === 'julian') parts.push('jul.');
    if (value.calendar === 'gregorian') parts.push('greg.');
    if (value.place?.label) parts.push(value.place.label);
    return parts.join(' ');
  })();

  const inputCls = "px-2 py-1.5 text-sm border border-gray-300 rounded focus:ring-1 focus:ring-primary-500 focus:border-primary-500 outline-none bg-white";

  return (
    <div>
      <label className="block text-xs text-gray-500 uppercase tracking-wide mb-1">{label}</label>

      <div className="flex items-center gap-2">
        <input
          type="number" min={1000} max={1900}
          placeholder="aasta"
          value={value.year}
          onChange={e => set({ year: e.target.value })}
          className={`w-20 ${inputCls}`}
        />
        {!open && summary && (
          <span className="text-xs text-gray-400 italic truncate max-w-[120px]">{summary}</span>
        )}
        <button
          type="button"
          onClick={() => setOpen(v => !v)}
          className={`ml-auto flex items-center gap-1 text-xs px-2 py-1 rounded transition-colors
            ${open
              ? 'text-primary-600 bg-primary-50 border border-primary-200'
              : 'text-gray-400 border border-gray-200 hover:text-gray-600 hover:border-gray-300'}`}
        >
          {open ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
          täpsem
        </button>
      </div>

      {open && (
        <div className="mt-2 pl-3 border-l-2 border-gray-200 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <input
              type="number" min={1} max={12}
              placeholder="kuu"
              value={value.month}
              onChange={e => set({ month: e.target.value })}
              className={`w-14 ${inputCls}`}
            />
            <input
              type="number" min={1} max={31}
              placeholder="päev"
              value={value.day}
              onChange={e => set({ day: e.target.value })}
              className={`w-14 ${inputCls}`}
            />
            <label className="flex items-center gap-1 text-sm text-gray-600 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={value.circa}
                onChange={e => set({ circa: e.target.checked })}
                className="accent-primary-600"
              />
              <span className="font-mono">~</span> ligikaudu
            </label>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={value.bound}
              onChange={e => set({ bound: e.target.value as DateDraft['bound'] })}
              className={inputCls}
            >
              <option value="">täpne kuupäev</option>
              <option value="before">enne seda</option>
              <option value="after">pärast seda</option>
            </select>
            <select
              value={value.calendar}
              onChange={e => set({ calendar: e.target.value as DateDraft['calendar'] })}
              className={inputCls}
            >
              <option value="">kalender märkimata</option>
              <option value="julian">Juliuse kalender</option>
              <option value="gregorian">Gregoriuse kalender</option>
            </select>
            <EntityPicker
              label=""
              placeholder="koht"
              type="place"
              value={value.place}
              onChange={v => set({ place: v })}
              lang={lang}
            />
          </div>
        </div>
      )}
    </div>
  );
};

export default DateField;
