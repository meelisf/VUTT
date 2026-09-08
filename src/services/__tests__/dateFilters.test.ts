import { describe, expect, it, vi } from 'vitest';
import { pushYearFilter, searchWorks } from '../searchService';
import { parseDateParam } from '../../pages/search/hooks/useSearchUrlParams';

vi.stubGlobal('window', { location: { protocol: 'http:' } });

describe('date search boundaries', () => {
  it('preserves precise URL dates and legacy numeric years', () => {
    expect(parseDateParam('1803')).toBe(1803);
    expect(parseDateParam('1803-05-15')).toBe('1803-05-15');
  });
  it('keeps year overlap and expands a month to inclusive boundaries', () => {
    const years: string[] = [], dates: string[] = [];
    pushYearFilter(years, 1803, 1804);
    pushYearFilter(dates, '1803-05', '1803-05');
    expect(years).toEqual(['year_end >= 1803', 'year_start <= 1804']);
    expect(dates).toEqual(['date_end >= 18030501', 'date_start <= 18030531']);
  });
  it('does not broaden invalid or reversed filters', () => {
    for (const [start, end] of [['1803-02-31', '1804'], ['1804', '1803']]) {
      const filters: string[] = [];
      pushYearFilter(filters, start, end);
      expect(filters).toEqual(['year_start < 0']);
    }
  });
  it('sends day bounds and chronological sort to the search engine', async () => {
    const calls: any[] = [];
    const index = { search: async (_q: string, options: any) => { calls.push(options); return { hits: [], estimatedTotalHits: 0 }; } } as any;
    await searchWorks(index, '', { yearStart: '1803-05-15', yearEnd: '1804-06', sort: 'year_asc' });
    expect(calls[0].filter).toContain('date_end >= 18030515');
    expect(calls[0].filter).toContain('date_start <= 18040631');
    expect(calls[0].sort).toEqual(['date_sort:asc']);
  });
});
