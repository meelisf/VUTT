import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../apiClient', () => ({
  apiGet: vi.fn(),
  apiPost: vi.fn(),
  apiPatch: vi.fn(),
  apiPut: vi.fn(),
  apiDelete: vi.fn(),
  apiDeleteWithBody: vi.fn(),
  ApiError: class ApiError extends Error {
    status: number;
    constructor(message: string, status: number) { super(message); this.status = status; }
  },
}));

import { apiGet, apiPost } from '../apiClient';
import { getWorkSetWorkIds, invalidateWorkSetIds, addWorks, listWorkSetsSafe } from '../workSetService';

const get = vi.mocked(apiGet);
const post = vi.mocked(apiPost);

describe('getWorkSetWorkIds', () => {
  beforeEach(() => {
    invalidateWorkSetIds();
    vi.clearAllMocks();
  });

  it('hoiab aktiivse valiku loendit, ei küsi kaks korda', async () => {
    get.mockResolvedValue({ work_ids: ['a'], revision: 2 } as never);
    await getWorkSetWorkIds('ws_1');
    await getWorkSetWorkIds('ws_1');
    expect(get).toHaveBeenCalledTimes(1);
  });

  it('liikmesuse muutus tühjendab loendi', async () => {
    get.mockResolvedValue({ work_ids: ['a'], revision: 2 } as never);
    await getWorkSetWorkIds('ws_1');
    invalidateWorkSetIds('ws_1');
    await getWorkSetWorkIds('ws_1');
    expect(get).toHaveBeenCalledTimes(2);
  });

  it('liikmete lisamine tühjendab loendi automaatselt', async () => {
    get.mockResolvedValue({ work_ids: ['a'], revision: 2 } as never);
    post.mockResolvedValue({ work_ids: ['a', 'b'], revision: 3 } as never);
    await getWorkSetWorkIds('ws_1');
    await addWorks('ws_1', ['b'], 2);
    await getWorkSetWorkIds('ws_1');
    expect(get).toHaveBeenCalledTimes(2);
  });

  it('403 ei tagasta tühja loendit, vaid viskab', async () => {
    get.mockRejectedValue(Object.assign(new Error('keelatud'), { status: 403 }));
    await expect(getWorkSetWorkIds('ws_1')).rejects.toThrow();
  });

  it('ebaõnnestunud päringut ei vahemälustata', async () => {
    get.mockRejectedValueOnce(Object.assign(new Error('keelatud'), { status: 403 }));
    await expect(getWorkSetWorkIds('ws_1')).rejects.toThrow();
    get.mockResolvedValue({ work_ids: ['a'], revision: 2 } as never);
    expect(await getWorkSetWorkIds('ws_1')).toEqual(['a']);
  });

  it('samaaegsed kutsed jagavad ühte päringut', async () => {
    get.mockResolvedValue({ work_ids: ['a'], revision: 2 } as never);
    const [x, y] = await Promise.all([getWorkSetWorkIds('ws_1'), getWorkSetWorkIds('ws_1')]);
    expect(get).toHaveBeenCalledTimes(1);
    expect(x).toEqual(y);
  });
});

/**
 * #354 regressioon: `listWorkSets().catch(() => [])` muutis 401-i tühjaks
 * loendiks. Tagajärg oli nähtamatu — „kogusid ei ole" ja „ei saanud teada"
 * näevad UI-s ühtemoodi välja, ainult „Lisa" nupp kadus ära.
 */
describe('listWorkSetsSafe', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('õnnestumisel annab kogud ja error = null', async () => {
    get.mockResolvedValue({ work_sets: [{ id: 'ws_1' }] } as never);
    expect(await listWorkSetsSafe()).toEqual({ sets: [{ id: 'ws_1' }], error: null });
  });

  it('401 EI OLE tühi loend — viga tuleb kaasa', async () => {
    const viga = Object.assign(new Error('keelatud'), { status: 401 });
    get.mockRejectedValue(viga);
    const r = await listWorkSetsSafe();
    expect(r.sets).toEqual([]);
    expect(r.error).toBe(viga);
  });

  it('päris tühi vastus annab error = null', async () => {
    get.mockResolvedValue({ work_sets: [] } as never);
    expect(await listWorkSetsSafe()).toEqual({ sets: [], error: null });
  });
});
