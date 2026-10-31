import { describe, it, expect, vi, beforeEach } from 'vitest';

const apiGet = vi.fn();
const apiPut = vi.fn();
vi.mock('../apiClient', () => ({ apiGet: (...a: unknown[]) => apiGet(...a), apiPut: (...a: unknown[]) => apiPut(...a) }));
vi.mock('../../config', () => ({ FILE_API_URL: '/api/files' }));

import { variantRelations, fetchRelations, changeRelations } from '../relationsService';

describe('relationsService', () => {
  beforeEach(() => { apiGet.mockReset(); apiPut.mockReset(); });

  it('variantRelations jätab alles ainult isVersionOf', () => {
    expect(variantRelations([
      { id: 'a', rel_type: 'isVersionOf' }, { id: 'b', rel_type: 'isPartOf' },
    ])).toEqual([{ id: 'a', rel_type: 'isVersionOf' }]);
    expect(variantRelations(undefined)).toEqual([]);
    expect(variantRelations(null)).toEqual([]);
  });

  it('fetchRelations küsib GET /works/{id}/relations', async () => {
    apiGet.mockResolvedValue([{ id: 'w2', rel_type: 'isVersionOf' }]);
    expect(await fetchRelations('w1', 't')).toEqual([{ id: 'w2', rel_type: 'isVersionOf' }]);
    expect(apiGet).toHaveBeenCalledWith('/api/files/works/w1/relations', { token: 't' });
  });

  it('changeRelations saadab PUT-i ja tagastab relations', async () => {
    apiPut.mockResolvedValue({ relations: [{ id: 'w2', rel_type: 'isVersionOf' }] });
    const add = [{ id: 'w2', rel_type: 'isVersionOf' as const }];
    expect(await changeRelations('w1', { add, remove: [] }, 't')).toEqual([{ id: 'w2', rel_type: 'isVersionOf' }]);
    expect(apiPut).toHaveBeenCalledWith('/api/files/works/w1/relations', { add, remove: [] }, { token: 't' });
  });
});
