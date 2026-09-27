import { describe, it, expect } from 'vitest';
import { groupPersonWorks } from '../personWorks';

const part = (first_page: number) => ({ kind: 'letter', title: '', year: 1684, first_page, pages: [first_page] });

describe('groupPersonWorks', () => {
  it('üks rida teose kohta, osa rollid osa all, järjekord säilib', () => {
    const groups = groupPersonWorks([
      { work_id: 'w2', role: 'praeses' },
      { work_id: 'w1', role: 'auctor', part_id: 'k2', part: part(12) },
      { work_id: 'w1', role: 'auctor', part_id: 'k1', part: part(7) },
      { work_id: 'w1', role: 'addressee', part_id: 'k1', part: part(7) },
      { work_id: 'w1', role: 'mentioned', pages: [3, 9] },
      { work_id: 'w2', role: 'subject' },
    ]);
    expect(groups.map(g => g.work_id)).toEqual(['w2', 'w1']);
    expect(groups[0]).toMatchObject({ roles: ['praeses', 'subject'], page: 1, parts: [] });
    expect(groups[1].roles).toEqual(['mentioned']);
    expect(groups[1].page).toBe(3);
    expect(groups[1].parts.map(p => [p.part_id, p.roles])).toEqual([['k1', ['auctor', 'addressee']], ['k2', ['auctor']]]);
  });

  it('ainult osa rolliga teos: teose rida rollideta', () => {
    const [g] = groupPersonWorks([{ work_id: 'w1', role: 'auctor', part_id: 'k1' }]);
    expect(g.roles).toEqual([]);
    expect(g.parts[0].part).toBeUndefined();
  });
});
