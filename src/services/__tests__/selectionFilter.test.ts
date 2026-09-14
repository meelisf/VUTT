import { describe, it, expect } from 'vitest';
import { selectionFilterClause } from '../selectionFilter';

describe('selectionFilterClause', () => {
  it('kõik teosed ei lisa filtrit', () => {
    expect(selectionFilterClause({ kind: 'all' }, null)).toEqual([]);
  });

  it('püsikogu filtreerib hierarhia järgi', () => {
    expect(selectionFilterClause({ kind: 'collection', id: 'academia-gustaviana' }, null))
      .toEqual(['collections_hierarchy = "academia-gustaviana"']);
  });

  it('töökollektsioon filtreerib work_id järgi', () => {
    expect(selectionFilterClause({ kind: 'work_set', id: 'ws_1' }, ['a', 'b']))
      .toEqual(['work_id IN ["a", "b"]']);
  });

  it('TÜHI loend annab null tulemust, mitte filtri ärajätmist', () => {
    expect(selectionFilterClause({ kind: 'work_set', id: 'ws_1' }, []))
      .toEqual(['work_id IN []']);
  });

  it('laadimata loend (null) ei tohi anda piiramata korpust', () => {
    expect(() => selectionFilterClause({ kind: 'work_set', id: 'ws_1' }, null)).toThrow();
  });
});
