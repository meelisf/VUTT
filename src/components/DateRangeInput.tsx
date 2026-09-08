import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { dateBound, parsePartialDate } from '../utils/workDating';

const fieldClass = 'min-w-0 w-full border border-gray-300 rounded px-2 py-1.5 text-sm bg-white';

export function DatePartsInput({ value, onChange, label, detailed, calendar, inline, parts = 'all', unknownMonth }: {
  value: string; onChange: (value: string) => void; label: string; detailed: boolean; calendar?: string;
  /** Filtriribal jagatakse väli kahe rea vahel: aasta üleval, kuu+päev all. */
  parts?: 'all' | 'year' | 'subyear';
  /** Tühi kuu tähendab „teadmata" (metaandmete vorm: väide allika kohta), mitte
   *  „ükskõik mis" (filter). Vaikimisi neutraalne — filtreid on rohkem. */
  unknownMonth?: boolean;
  /** Silt kastide ETTE samale reale (filtririba), mitte nende peale (vorm).
   *  Ribal tegi sildirida rühma teistest juhtelementidest kõrgemaks ja jättis
   *  siltide alla tühja ruumi; vormis on silt kastide kohal õigem. */
  inline?: boolean;
}) {
  const { t } = useTranslation('common');
  const [year = '', month = '', day = ''] = value.split('-');
  const set = (y: string, m: string, d: string) => onChange(y + (m ? `-${m}` : '') + (m && d ? `-${d.padStart(2, '0')}` : ''));
  const invalid = !!value && !parsePartialDate(value, calendar);
  return <fieldset className={inline ? 'min-w-0 flex flex-wrap items-center gap-1.5' : 'min-w-0 space-y-1'}>
    <legend className={inline ? 'sr-only' : 'text-xs text-gray-500 mb-1'}>{label}</legend>
    {inline && <span aria-hidden="true" className="text-xs text-gray-500 whitespace-nowrap">{label}</span>}
    <div className="flex flex-wrap gap-1">
      {parts !== 'subyear' && <input aria-label={`${label}: ${t('dating.year')}`} aria-invalid={invalid} type="text" inputMode="numeric" maxLength={4}
        className={`${fieldClass} !w-20`} placeholder={t('dating.year')} value={year}
        onChange={e => { if (/^\d{0,4}$/.test(e.target.value)) set(e.target.value, e.target.value ? month : '', e.target.value ? day : ''); }} />}
      {detailed && parts !== 'year' && <>
        <select aria-label={`${label}: ${t('dating.month')}`} className={`${fieldClass} !w-auto`} value={month} disabled={!year}
          onChange={e => set(year, e.target.value, '')}>
          {/* Filtris tähendab tühi kuu „ükskõik mis", mitte „teadmata" — ja
              „Kuu teadmata" oli ühtlasi kõige laiem valik, mis venitas rippmenüü
              ~60 px võrra ja lükkas sortimise teisele reale. */}
          <option value="">{t(unknownMonth ? 'dating.monthUnknown' : 'dating.month')}</option>
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
    {invalid && <p role="alert" className={`text-xs text-red-600 ${inline ? 'basis-full' : ''}`}>{t('dating.invalid')}</p>}
  </fieldset>;
}

export default function DateRangeInput({ start, end, onStartChange, onEndChange, compact }: {
  start: string; end: string; onStartChange: (value: string) => void; onEndChange: (value: string) => void;
  /** Filtririba: KÕIK mahub ühele reale. Selgitus läheb ikooni taha ja kokkuvõte
   *  nupu kõrvale — iga rühma sisse tekkiv teine rida nihutab riba ülejäänud
   *  juhtelemendid joonelt maha. Külgribas (vaikimisi) on ruumi ja tekst on nähtav. */
  compact?: boolean;
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
  const kokkuvote = precise && <span className="text-xs text-gray-600 whitespace-nowrap">{summary(start)} – {summary(end)}</span>;
  const tagurpidi = start && end && dateBound(start)! > dateBound(end, true)!;
  // Kuu- ja päevavali on väljas, kuni aasta puudub (`DatePartsInput`: piir
  // koostatakse kujul aasta-kuu-päev). Ilma selgituseta näevad nad välja nagu
  // katkised kohatäited — nii see tootmises ka paistis.
  const aastataVeel = !start && !end;
  const vihje = aastataVeel ? t('dating.yearFirst') : t('dating.overlapHint');
  const nupp = <button type="button" aria-expanded={expanded}
    className="text-xs text-primary-600 hover:underline whitespace-nowrap" onClick={() => setExpanded(!expanded)}>
    {t(expanded ? 'dating.collapse' : 'dating.refine')}
  </button>;

  // FILTRIRIBA. Ülemine rida on ALATI sama: sildid, aastad, nupp — nii ei liigu
  // riba ülejäänud juhtelemendid (sortimine) kunagi. Kuu ja päev tulevad omaette
  // reale (`basis-full order-last`), mis flex-ribal murdub viimasena, seega
  // aastad ja sortimine jäävad ülemisele reale paigale.
  if (compact) return <>
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 min-w-0">
      <DatePartsInput value={start} onChange={onStartChange} label={t('dating.from')} detailed={expanded} inline parts="year" />
      <DatePartsInput value={end} onChange={onEndChange} label={t('dating.until')} detailed={expanded} inline parts="year" />
      {nupp}
      {!expanded && kokkuvote}
    </div>
    {(expanded || tagurpidi) && <div className="basis-full order-last flex flex-wrap items-center gap-x-4 gap-y-1">
      {expanded && <>
        <DatePartsInput value={start} onChange={onStartChange} label={t('dating.from')} detailed inline parts="subyear" />
        <DatePartsInput value={end} onChange={onEndChange} label={t('dating.until')} detailed inline parts="subyear" />
        <span className="text-xs text-gray-500">{vihje}</span>
      </>}
      {tagurpidi && <span role="alert" className="text-xs text-red-600">{t('dating.reversed')}</span>}
    </div>}
  </>;

  // KÜLGRIBA: kitsas veerg, ruumi on püsti — sildid kastide kohal, tekstid all.
  return <div className="space-y-1">
    <div className="flex flex-wrap gap-2">
      <DatePartsInput value={start} onChange={onStartChange} label={t('dating.from')} detailed={expanded} />
      <DatePartsInput value={end} onChange={onEndChange} label={t('dating.until')} detailed={expanded} />
    </div>
    {nupp}
    {!expanded && kokkuvote}
    {tagurpidi && <p role="alert" className="text-xs text-red-600">{t('dating.reversed')}</p>}
    {expanded && <p className="text-xs text-gray-500">{vihje}</p>}
  </div>;
}
