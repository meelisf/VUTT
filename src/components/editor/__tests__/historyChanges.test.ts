import { describe, expect, it } from 'vitest';
import { canRestoreVersion, groupCounts, hasTextChange } from '../historyChanges';

describe('historyChanges', () => {
  it('taaste on tähenduslik ainult teksti või märkuste muutusel', () => {
    expect(canRestoreVersion({ text: true })).toBe(true);
    expect(canRestoreVersion({ text: false, text_annotations: { modified: [{ id: 1, before: 'a', after: 'b' }] } })).toBe(true);
    expect(canRestoreVersion({ text: false, comments: { added: [{ id: 'c', text: 'x' }] } })).toBe(false);
    expect(canRestoreVersion({ text: false, page_tags: { added: ['Tartu'] } })).toBe(false);
    expect(canRestoreVersion(undefined)).toBe(true);
  });

  it('tekstidiff ainult tekstimuutusel', () => {
    expect(hasTextChange({ text: false, status: { before: 'Toores', after: 'Töös' } })).toBe(false);
    expect(hasTextChange(undefined)).toBe(true);
  });

  it('loendab grupi', () => {
    expect(groupCounts({ added: [{ id: 1, text: 'a' }], removed: [] })).toEqual({ added: 1, modified: 0, removed: 0 });
    expect(groupCounts(undefined)).toEqual({ added: 0, modified: 0, removed: 0 });
  });
});
