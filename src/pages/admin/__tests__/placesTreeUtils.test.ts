import { describe, it, test, expect } from 'vitest';
import { buildPlacesTree } from '../placesTreeUtils';
import type { PlaceEntry } from '../../../prosopography/types';

const PLACES: Record<string, PlaceEntry> = {
  Smaland: { id: null, labels: { et: 'Smaland', sv: 'Småland' }, type: 'province', group: 'rootsi' },
  Wexionensis: { id: null, labels: { et: 'Wexionensis' }, type: 'parish', parent_key: 'Smaland' },
  Kronoberg: { id: null, labels: { et: 'Kronoberg' }, type: 'county', parent_key: 'Smaland' },
  Riga: { id: null, labels: { et: 'Riia', en: 'Riga' }, type: 'city', parent_key: 'Livland' },
  Livland: { id: null, labels: { et: 'Liivimaa' }, type: 'historical_region', group: 'liivimaa' },
  Isolated: { id: null, labels: { et: 'Isoleeritud' }, type: 'city' },
};

const GROUPS = {
  rootsi: { labels: { et: 'Rootsi piirkonnad' }, sort_order: 10 },
  liivimaa: { labels: { et: 'Liivimaa' }, sort_order: 20 },
};

describe('buildPlacesTree', () => {
  it('grupeerib kohad origin_groups järgi', () => {
    const tree = buildPlacesTree(PLACES, GROUPS);
    const groupKeys = tree.map(g => g.groupKey);
    expect(groupKeys).toContain('rootsi');
    expect(groupKeys).toContain('liivimaa');
  });

  it('sorteerib grupid sort_order järgi', () => {
    const tree = buildPlacesTree(PLACES, GROUPS);
    expect(tree[0].groupKey).toBe('rootsi');
    expect(tree[1].groupKey).toBe('liivimaa');
  });

  it('paneb grupita kohad lõppu', () => {
    const tree = buildPlacesTree(PLACES, GROUPS);
    const last = tree[tree.length - 1];
    expect(last.groupKey).toBeNull();
    expect(last.nodes.some(n => n.key === 'Isolated')).toBe(true);
  });

  it('ehitab parent-child hierarhia', () => {
    const tree = buildPlacesTree(PLACES, GROUPS);
    const rootsiGroup = tree.find(g => g.groupKey === 'rootsi')!;
    const smaland = rootsiGroup.nodes.find(n => n.key === 'Smaland')!;
    expect(smaland.children.map(c => c.key)).toContain('Wexionensis');
    expect(smaland.children.map(c => c.key)).toContain('Kronoberg');
  });

  it('Riga on Livlandi all, mitte eraldi juurena', () => {
    const tree = buildPlacesTree(PLACES, GROUPS);
    const liivimaaGroup = tree.find(g => g.groupKey === 'liivimaa')!;
    const livland = liivimaaGroup.nodes.find(n => n.key === 'Livland')!;
    expect(livland.children.map(c => c.key)).toContain('Riga');
    const allRoots = liivimaaGroup.nodes.map(n => n.key);
    expect(allRoots).not.toContain('Riga');
  });

  it('tagastab tühja puu kui kohti pole', () => {
    expect(buildPlacesTree({}, {})).toEqual([]);
  });
});

describe('buildPlacesTree — nested groups', () => {
  test('sub-group appears under parent group', () => {
    const places: Record<string, PlaceEntry> = {
      'smaland': { id: null, labels: { et: 'Småland' }, group: 'gootaland' },
      'rootsi-country': { id: null, labels: { et: 'Rootsi' }, group: 'rootsi' },
    };
    const groups = {
      rootsi: { labels: { et: 'Rootsi' }, sort_order: 2 },
      gootaland: { labels: { et: 'Götaland' }, sort_order: 10, parent: 'rootsi' },
    };
    const result = buildPlacesTree(places, groups);
    expect(result).toHaveLength(1);
    expect(result[0].groupKey).toBe('rootsi');
    expect(result[0].subGroups).toHaveLength(1);
    expect(result[0].subGroups[0].groupKey).toBe('gootaland');
    expect(result[0].subGroups[0].nodes[0].key).toBe('smaland');
  });

  test('top-level group with no parent stays top-level', () => {
    const places: Record<string, PlaceEntry> = {
      'livland': { id: null, labels: { et: 'Livland' }, group: 'liivimaa' },
    };
    const groups = {
      liivimaa: { labels: { et: 'Liivimaa' }, sort_order: 6 },
    };
    const result = buildPlacesTree(places, groups);
    expect(result).toHaveLength(1);
    expect(result[0].groupKey).toBe('liivimaa');
    expect(result[0].subGroups).toHaveLength(0);
  });

  test('top-level group with only sub-groups and no direct places still renders', () => {
    const places: Record<string, PlaceEntry> = {
      'smaland': { id: null, labels: { et: 'Småland' }, group: 'gootaland' },
    };
    const groups = {
      rootsi: { labels: { et: 'Rootsi' }, sort_order: 2 },
      gootaland: { labels: { et: 'Götaland' }, sort_order: 10, parent: 'rootsi' },
    };
    const result = buildPlacesTree(places, groups);
    expect(result).toHaveLength(1);
    expect(result[0].groupKey).toBe('rootsi');
    expect(result[0].nodes).toHaveLength(0);
    expect(result[0].subGroups).toHaveLength(1);
  });
});
