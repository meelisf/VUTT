import { describe, expect, it } from 'vitest';
import { initialEditorTab } from '../initialTab';

describe('initialEditorTab', () => {
  it('?part= avab märgenduse vahekaardi ka siis, kui vaikevalik on redaktor', () => {
    expect(initialEditorTab('p1', 'edit')).toBe('annotate');
  });
  it('ilma osata kehtib kasutaja vaikevalik', () => {
    expect(initialEditorTab(null, 'annotate')).toBe('annotate');
    expect(initialEditorTab(null, undefined)).toBe('edit');
  });
});
