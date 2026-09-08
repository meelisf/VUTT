import { describe, expect, it } from 'vitest';
import i18next from 'i18next';
import et from '../../locales/et/common.json';
import en from '../../locales/en/common.json';
import { dateBound, datingError, parseDatingText, parsePartialDate } from '../workDating';
import { formatYearDisplay } from '../yearDisplayUtils';

describe('source dating', () => {
  it('reads the legacy letter range without interpreting prose', () => {
    expect(parseDatingText('17-05-1803 - 17-05-1804')).toEqual({ start: '1803-05-17', end: '1804-05-17' });
    expect(parseDatingText('31. dets.1812 - 9. jaan.1823; 7 k. s.d.')).toBeNull();
    expect(parseDatingText('31.02.1803')).toBeNull();
  });
  it('keeps missing components unknown and uses inclusive search bounds', () => {
    expect(parsePartialDate('1803-05')).toEqual([1803, 5]);
    expect(dateBound('1803-05')).toBe(18030501);
    expect(dateBound('1803-05', true)).toBe(18030531);
    expect(dateBound('1803', true)).toBe(18031231);
  });
  it('validates calendar dates and range order', () => {
    expect(datingError({ start: '1804', end: '1803' })).toBe(true);
    expect(datingError({ start: '1803', end: '' })).toBe(true);
    expect(datingError({ start: '1803-02-29' })).toBe(true);
    expect(datingError({ start: '1700-02-29', calendar: 'gregorian' })).toBe(true);
    expect(datingError({ start: '1700-02-29', calendar: 'julian' })).toBe(false);
    expect(datingError({ start: '1712-02-30' })).toBe(false);
    expect(datingError({ start: '1700-02-29', calendar: 'swedish' })).toBe(true);
    expect(datingError({ start: '1712-02-30', calendar: 'swedish' })).toBe(false);
  });
  it('renders words in the interface language without converting calendars', async () => {
    const i18n = i18next.createInstance();
    await i18n.init({ lng: 'et', resources: { et: { common: et }, en: { common: en } } });
    const d = { start: '1803-05-15', end: '1804-06-15' };
    expect(formatYearDisplay(null, null, i18n.t, d)).toBe('15. mai 1803 – 15. juuni 1804');
    await i18n.changeLanguage('en');
    expect(formatYearDisplay(null, null, i18n.t, d)).toBe('15 May 1803 – 15 June 1804');
    expect(formatYearDisplay('1803-05', null, i18n.t)).toBe('May 1803');
    expect(formatYearDisplay(null, null, i18n.t, { start: '1803-05-15', calendar: 'julian' })).toBe('15 May 1803 (Julian calendar)');
  });
});
