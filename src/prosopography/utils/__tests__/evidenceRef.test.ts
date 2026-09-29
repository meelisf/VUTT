import { describe, expect, it } from 'vitest';
import { evidenceRef, evidenceSources, evidenceWorkIds } from '../evidenceRef';

const titles: Record<string, string> = { w1: 'Consuetudines' };
const titleOf = (id: string) => titles[id];

describe('evidenceRef', () => {
  it('VUTT-i leht: link teose lehele, pealkiri, trükise number eelistatud', () => {
    expect(evidenceRef({ source_kind: 'vutt_page', work_id: 'w1', page: 5, printed_page: '3',
      quote: 'Notarius publicus' }, titleOf, 'lk')).toEqual({
      href: '/work/w1/5', external: false, title: 'Consuetudines', locator: 'lk 3', quote: 'Notarius publicus' });
  });
  it('tundmatu teos: pealkirja asemel work_id', () => {
    expect(evidenceRef({ source_kind: 'vutt_page', work_id: 'zz', page: 2 }, titleOf, 'lk').title).toBe('zz');
  });
  it('kirjandus: citation + locator; vanal tõendil source_id', () => {
    expect(evidenceRef({ source_kind: 'literature', source_id: 'ABC', citation: 'Donecker 2012, X',
      locator: 'lk 4' }, titleOf, 'lk')).toMatchObject({ href: null, title: 'Donecker 2012, X', locator: 'lk 4' });
    expect(evidenceRef({ source_kind: 'literature', source_id: 'ABC', locator: 'lk 4' }, titleOf, 'lk').title).toBe('ABC');
  });
  it('vana veebitõend: link ainult http(s) URL-ile', () => {
    expect(evidenceRef({ source_kind: 'external', url: 'https://sok.riksarkivet.se/x' }, titleOf, 'lk'))
      .toMatchObject({ href: 'https://sok.riksarkivet.se/x', external: true });
    expect(evidenceRef({ source_kind: 'external', url: 'javascript:alert(1)' }, titleOf, 'lk'))
      .toMatchObject({ href: null, title: 'javascript:alert(1)' });
  });
  it('pikk katke lühendatakse', () => {
    const ref = evidenceRef({ source_kind: 'vutt_page', work_id: 'w1', page: 1, quote: 'x'.repeat(300) }, titleOf, 'lk');
    expect(ref.quote.length).toBeLessThanOrEqual(161);
    expect(ref.quote.endsWith('…')).toBe(true);
  });
  it('evidenceWorkIds kogub unikaalsed work_id-d', () => {
    expect(evidenceWorkIds([{ evidence: [{ source_kind: 'vutt_page', work_id: 'a' }, { source_kind: 'vutt_page', work_id: 'a' }] },
      { evidence: [{ source_kind: 'literature', source_id: 'L' }] }, {}])).toEqual(['a']);
  });
});

describe('evidenceSources', () => {
  it('kogub kõigi ridade allikad kordusteta, teos lingiga teose juurde', () => {
    const entries = [
      { evidence: [{ source_kind: 'vutt_page', work_id: 'w1', page: 5 },
        { source_kind: 'literature', source_id: 'ABC', citation: 'Sak 1997, Artikkel', locator: 'lk 74' }] },
      { evidence: [{ source_kind: 'literature', source_id: 'ABC', citation: 'Sak 1997, Artikkel', locator: 'lk 72' },
        { source_kind: 'vutt_page', work_id: 'w1', page: 9 }] },
      { evidence: [{ source_kind: 'literature', source_id: 'OLD', locator: 'lk 1' }] },
      {},
    ];
    expect(evidenceSources(entries, titleOf)).toEqual([
      { key: 'vutt:w1', href: '/work/w1', external: false, title: 'Consuetudines' },
      { key: 'lit:OLD', href: null, external: false, title: 'OLD' },
      { key: 'lit:ABC', href: null, external: false, title: 'Sak 1997, Artikkel' },
    ]);
  });
  it('vana veebitõend: link ainult http(s) URL-ile', () => {
    expect(evidenceSources([{ evidence: [{ source_kind: 'external', url: 'javascript:x' }] }], titleOf))
      .toEqual([{ key: 'url:javascript:x', href: null, external: false, title: 'javascript:x' }]);
  });
});
