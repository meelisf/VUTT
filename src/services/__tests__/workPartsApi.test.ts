// src/services/__tests__/workPartsApi.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const calls: Array<{ method: string; path: string; body?: unknown }> = [];
vi.mock('../apiClient', () => ({
  apiGet: (path: string) => { calls.push({ method: 'GET', path }); return Promise.resolve({ parts: [{ id: 'p1' }] }); },
  apiPost: (path: string, body: unknown) => { calls.push({ method: 'POST', path, body }); return Promise.resolve({ id: 'p1' }); },
  apiPut: (path: string, body: unknown) => { calls.push({ method: 'PUT', path, body }); return Promise.resolve({ id: 'p1' }); },
  apiDelete: (path: string) => { calls.push({ method: 'DELETE', path }); return Promise.resolve(null); },
}));

import { changePartPages, createPart, deletePart, listParts, updatePart } from '../workPartsApi';

beforeEach(() => { calls.length = 0; });

describe('workPartsApi', () => {
  it('kasutab /works/{id}/parts otspunkte', async () => {
    expect(await listParts('w1', 't')).toEqual([{ id: 'p1' }]);
    await createPart('w1', { kind: 'letter', pages: ['a'], creators: [], attached_to: null }, 't');
    await updatePart('w1', 'p1', { kind: 'letter', pages: ['a'], creators: [], attached_to: null }, 't');
    await changePartPages('w1', 'p1', ['b'], ['a'], 't');
    await deletePart('w1', 'p1', 't');
    expect(calls.map(c => `${c.method} ${c.path}`)).toEqual([
      'GET /works/w1/parts', 'POST /works/w1/parts', 'PUT /works/w1/parts/p1',
      'POST /works/w1/parts/p1/pages', 'DELETE /works/w1/parts/p1',
    ]);
    expect(calls[3].body).toEqual({ add: ['b'], remove: ['a'] });
  });

  it('kodeerib id-d URL-is', async () => {
    await deletePart('w 1', 'p/1', 't');
    expect(calls[0].path).toBe('/works/w%201/parts/p%2F1');
  });
});
