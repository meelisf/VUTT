/** @vitest-environment jsdom */
import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

vi.mock('../../../services/collectionService', () => ({
  getVocabularies: vi.fn().mockResolvedValue({ languages: {} }),
}));

import { useWorkFilterModel, WorkFilterInput } from '../useWorkFilterModel';

function setup(over: Partial<WorkFilterInput> = {}) {
  const spies = {
    onGenreChange: vi.fn(), onTagsChange: vi.fn(), onTypeChange: vi.fn(),
    onStatusChange: vi.fn(), onLanguagesChange: vi.fn(),
  };
  const input: WorkFilterInput = {
    selectedGenre: null, selectedTags: [], selectedType: null, selectedStatus: null, selectedLanguages: [],
    lang: 'et', ...spies, ...over,
  };
  const r = renderHook(() => useWorkFilterModel(input));
  Object.values(spies).forEach(s => s.mockClear());
  return { model: () => r.result.current, spies };
}

describe('applyWorkFilter = sama, mis külgriba valik', () => {
  it('žanr', () => {
    const { model, spies } = setup();
    act(() => model().applyWorkFilter('genre', 'Q3497659'));
    expect(spies.onGenreChange).toHaveBeenCalledWith('Q3497659');
  });

  it('tüüp', () => {
    const { model, spies } = setup();
    act(() => model().applyWorkFilter('type', 'Q87167'));
    expect(spies.onTypeChange).toHaveBeenCalledWith('Q87167');
  });

  it('märksõna: kiip ja külgriba toggleTag annavad sama kutse', () => {
    const a = setup({ selectedTags: ['Qa'] });
    act(() => a.model().applyWorkFilter('tag', 'Qb'));
    const b = setup({ selectedTags: ['Qa'] });
    act(() => b.model().toggleTag('Qb'));
    expect(a.spies.onTagsChange.mock.calls).toEqual(b.spies.onTagsChange.mock.calls);
    expect(a.spies.onTagsChange).toHaveBeenCalledWith(['Qa', 'Qb']);
  });

  it('juba valitud märksõna: ei muuda midagi', () => {
    const { model, spies } = setup({ selectedTags: ['Qa'] });
    act(() => model().applyWorkFilter('tag', 'Qa'));
    expect(spies.onTagsChange).not.toHaveBeenCalled();
  });
});
