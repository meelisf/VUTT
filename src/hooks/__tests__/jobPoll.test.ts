import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../services/apiClient';
import { pollUntil } from '../useJobPoll';

const base = { intervalMs: 0, isRunning: (s: { state: string }) => s.state === 'running' };

describe('pollUntil (#675 B)', () => {
  it('pollib kuni töö ei käi; onStatus saab ka viimase oleku', async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce({ state: 'running' })
      .mockResolvedValueOnce({ state: 'done' });
    const seen: string[] = [];
    const res = await pollUntil({ ...base, request: fetch, onStatus: (s) => seen.push(s.state) });
    expect(res).toEqual({ kind: 'finished', status: { state: 'done' } });
    expect(seen).toEqual(['running', 'done']);
  });

  it('ApiError on lõplik — teist päringut ei tehta', async () => {
    const err = new ApiError('HTTP 401', 401, null);
    const fetch = vi.fn().mockRejectedValue(err);
    const res = await pollUntil({ ...base, request: fetch });
    expect(res).toEqual({ kind: 'failed', error: err });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('võrguviga: kordab, lagi järjestikustel vigadel, edu nullib loenduri', async () => {
    const fetch = vi.fn()
      .mockRejectedValueOnce(new Error('net'))
      .mockResolvedValueOnce({ state: 'running' })
      .mockRejectedValue(new Error('net'));
    const res = await pollUntil({ ...base, request: fetch, maxErrors: 3 });
    expect(res.kind).toBe('failed');
    expect(fetch).toHaveBeenCalledTimes(5);   // 1 viga + edu + 3 viga
  });

  it('alive() false → vaikne lõpp, ka pärast pooleliolevat päringut', async () => {
    let alive = true;
    const onStatus = vi.fn();
    const fetch = vi.fn(async () => { alive = false; return { state: 'done' }; });
    const res = await pollUntil({ ...base, request: fetch, onStatus, alive: () => alive });
    expect(res).toEqual({ kind: 'cancelled' });
    expect(onStatus).not.toHaveBeenCalled();
  });
});
