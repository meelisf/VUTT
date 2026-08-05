import { describe, it, expect } from 'vitest';
import { formatEntryPeriod, institutionLabel } from '../entryPeriod';

const bounds = { before: 'enne', after: 'pärast' };

describe('formatEntryPeriod', () => {
  it('vormindab HistoricalDate vahemiku', () => {
    const occ = {
      date_from: { date: '1632-01-01', precision: 'year', is_circa: false, bound: null },
      date_to: { date: '1642-01-01', precision: 'year', is_circa: false, bound: null },
    };
    expect(formatEntryPeriod(occ, bounds)).toBe('1632–1642');
  });

  it('kuvab ainult alguse, kui lõpp puudub', () => {
    expect(formatEntryPeriod({ date_from: { date: '1638-01-18' } }, bounds)).toBe('1638');
  });

  it('kuvab ainult lõpu sidekriipsuga', () => {
    expect(formatEntryPeriod({ date_to: { date: '1642-01-01' } }, bounds)).toBe('–1642');
  });

  it('sama aasta korral ei korda', () => {
    expect(formatEntryPeriod(
      { date_from: { date: '1640-01-01' }, date_to: { date: '1640-12-31' } },
      bounds,
    )).toBe('1640');
  });

  it('toetab AA ISO-stringi (date_start/date_end)', () => {
    expect(formatEntryPeriod({ date_start: '1638-01-18', date_end: '1641-06-02' }, bounds)).toBe('1638–1641');
  });

  it('toetab vanu täisarvu välju', () => {
    expect(formatEntryPeriod({ year_from: 1632, year_to: 1642 }, bounds)).toBe('1632–1642');
    expect(formatEntryPeriod({ year: 1650 }, bounds)).toBe('1650');
  });

  it('lisab ligikaudsuse ja piiri märke', () => {
    expect(formatEntryPeriod({ date_from: { date: '1632-01-01', is_circa: true } }, bounds)).toBe('~1632');
    expect(formatEntryPeriod({ date_to: { date: '1642-01-01', bound: 'before' } }, bounds)).toBe('–enne 1642');
  });

  it('tagastab tühja stringi, kui aastaid pole', () => {
    expect(formatEntryPeriod({ label: 'arst' }, bounds)).toBe('');
    expect(formatEntryPeriod({ date_from: { date: null } }, bounds)).toBe('');
    expect(formatEntryPeriod(null, bounds)).toBe('');
    expect(formatEntryPeriod('arst', bounds)).toBe('');
  });
});

describe('institutionLabel', () => {
  const entry = {
    institution: 'Academia Gustaviana',
    institution_labels: { et: 'Academia Gustaviana', en: 'Academia Gustaviana', de: 'Academia Gustaviana' },
  };

  it('eelistab kasutaja keelt', () => {
    expect(institutionLabel({ ...entry, institution_labels: { et: 'Tartu ülikool', en: 'University of Tartu' } }, 'en'))
      .toBe('University of Tartu');
  });

  it('langeb tagasi et → en → esimesele olemasolevale', () => {
    expect(institutionLabel({ institution_labels: { de: 'Universität Rostock' } }, 'en')).toBe('Universität Rostock');
  });

  it('kasutab toorest institution välja, kui labeleid pole', () => {
    expect(institutionLabel({ institution: 'Academia Gustaviana' }, 'et')).toBe('Academia Gustaviana');
  });

  it('tagastab tühja stringi tundmatu kirje korral', () => {
    expect(institutionLabel({}, 'et')).toBe('');
    expect(institutionLabel('midagi', 'et')).toBe('');
  });
});
