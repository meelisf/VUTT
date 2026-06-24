import { describe, it, expect, vi, beforeEach } from 'vitest';

// meiliService tõmbab meilisearch kliendi — mockime vaid vajalikud eksportid
vi.mock('../meiliService', () => ({
  calculateWorkStatus: (statuses: string[]): string => {
    if (statuses.length === 0) return 'Toores';
    if (statuses.every(s => s === 'Valmis')) return 'Valmis';
    if (statuses.every(s => s === 'Toores' || !s)) return 'Toores';
    return 'Töös';
  },
  normalizeWork: vi.fn((hit: unknown) => hit),
  checkMixedContent: vi.fn(),
}));
// config.ts kasutab window.location.origin — mockime
vi.mock('../../config', () => ({
  MEILI_HOST: 'http://localhost:7700',
  MEILI_INDEX: 'teosed',
  IMAGE_BASE_URL: '/api/images',
  FILE_API_URL: '/api/files',
}));

import { getWorkStatuses, getWorkMetadata } from '../workService';

// =========================================================
// getWorkStatuses
// =========================================================

describe('getWorkStatuses', () => {
  it('tühi workIds → tühi kaart, ühtegi päringut', async () => {
    const index = { search: vi.fn() } as any;
    const result = await getWorkStatuses(index, []);
    expect(result.size).toBe(0);
    expect(index.search).not.toHaveBeenCalled();
  });

  it('arvutab koondstaatuse iga teose jaoks (paralleelsed päringud)', async () => {
    const index = {
      search: vi.fn().mockImplementation((_q: string, opts: any) => {
        const workId = opts.filter[0].match(/work_id = "(.*)"/)[1];
        const hits =
          workId === 'work-a'
            ? [
                { work_id: 'work-a', status: 'Valmis', lehekylje_number: 1 },
                { work_id: 'work-a', status: 'Valmis', lehekylje_number: 2 },
              ]
            : [
                { work_id: 'work-b', status: 'Toores', lehekylje_number: 1 },
                { work_id: 'work-b', status: 'Valmis', lehekylje_number: 2 },
              ];
        return Promise.resolve({ hits, estimatedTotalHits: hits.length });
      }),
    } as any;

    const result = await getWorkStatuses(index, ['work-a', 'work-b']);
    expect(result.get('work-a')).toBe('Valmis');
    expect(result.get('work-b')).toBe('Töös');
    // Iga teose jaoks eraldi päring (distinct='work_id' tõttu)
    expect(index.search).toHaveBeenCalledTimes(2);
  });

  it('kasutab Raw-fallbacki kui status puudub', async () => {
    const index = {
      search: vi.fn().mockResolvedValue({
        hits: [{ work_id: 'w', status: undefined, lehekylje_number: 1 }],
      }),
    } as any;
    const result = await getWorkStatuses(index, ['w']);
    expect(result.get('w')).toBe('Toores');
  });

  it('vea korral tagastab tühi kaart (ei viska)', async () => {
    const index = { search: vi.fn().mockRejectedValue(new Error('net')) } as any;
    const result = await getWorkStatuses(index, ['work-x']);
    expect(result.size).toBe(0);
  });
});

// =========================================================
// getWorkMetadata
// =========================================================

describe('getWorkMetadata', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('tagastab normalizeWork(hit) + legacy väljad', async () => {
    const index = {
      search: vi.fn().mockResolvedValue({
        hits: [{
          work_id: 'w', title: 'T', year: 1700,
          originaal_kataloog: 'kataloog-1', autor: 'Autorius', aasta: 1700,
        }],
      }),
    } as any;

    const result = await getWorkMetadata(index, 'w');
    expect(result?.catalog_name).toBe('kataloog-1');
    expect(result?.author).toBe('Autorius');
    expect(result?.aasta).toBe(1700);
    expect(result?.title).toBe('T');
  });

  it('autor langeb creators[0].name-ile kui autor puudub', async () => {
    const index = {
      search: vi.fn().mockResolvedValue({
        hits: [{
          work_id: 'w', title: 'T',
          creators: [{ name: 'Lorenz', role: 'auctor' }],
        }],
      }),
    } as any;
    const result = await getWorkMetadata(index, 'w');
    expect(result?.author).toBe('Lorenz');
  });

  it('aasta langeb year-ile kui aasta puudub', async () => {
    const index = {
      search: vi.fn().mockResolvedValue({
        hits: [{ work_id: 'w', title: 'T', year: 1690 }],
      }),
    } as any;
    const result = await getWorkMetadata(index, 'w');
    expect(result?.aasta).toBe(1690);
  });

  it('tagastab undefined kui hitte pole', async () => {
    const index = { search: vi.fn().mockResolvedValue({ hits: [] }) } as any;
    expect(await getWorkMetadata(index, 'missing')).toBeUndefined();
  });

  it('vea korral tagastab undefined', async () => {
    const index = { search: vi.fn().mockRejectedValue(new Error('net')) } as any;
    expect(await getWorkMetadata(index, 'w')).toBeUndefined();
  });
});
