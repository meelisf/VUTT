import { describe, it, expect, vi, beforeEach } from 'vitest';

const apiPatch = vi.fn();
vi.mock('../apiClient', async (orig) => {
  const real = await orig<typeof import('../apiClient')>();
  return { ...real, apiPatch: (...a: unknown[]) => apiPatch(...a) };
});

import { ApiError } from '../apiClient';
import {
  ManifestConflictError, patchExemplarImages, sourceLabel, type ExemplarManifest,
} from '../exemplarImagesService';
import { getExemplarImageUrl, getExemplarThumbUrl } from '../workImageService';

const t = (k: string, o?: Record<string, unknown>) => (o ? `${k}:${JSON.stringify(o)}` : k);

describe('exemplarImagesService', () => {
  beforeEach(() => { apiPatch.mockReset(); });

  it('pildi ja pisipildi URL', () => {
    expect(getExemplarImageUrl('w1', 'a1b2c3', 'x1y2z3')).toBe('/api/images/w1/_exemplars/a1b2c3/x1y2z3.jpg');
    expect(getExemplarThumbUrl('w1', 'a1b2c3', 'x1y2z3')).toBe('/api/images/w1/_exemplars/a1b2c3/_thumbs/_thumb_x1y2z3.jpg');
  });

  it('ADA allikas lingiga, leht kaasas', () => {
    const l = sourceLabel({ kind: 'ada', ref: '10062/14332', page: 3 }, t);
    expect(l.href).toBe('https://hdl.handle.net/10062/14332');
    expect(l.text).toContain('10062/14332');
    expect(l.text).toContain('3');
  });

  it('URL-allikas on link ainult http(s) puhul', () => {
    expect(sourceLabel({ kind: 'url', ref: 'https://digi.ub/x' }, t).href).toBe('https://digi.ub/x');
    expect(sourceLabel({ kind: 'url', ref: 'javascript:alert(1)' }, t).href).toBeUndefined();
    expect(sourceLabel({ kind: 'photo', ref: 'M. F. foto' }, t)).toEqual({ text: expect.stringContaining('M. F. foto') });
  });

  it('409 → ManifestConflictError praeguse manifestiga', async () => {
    const current: ExemplarManifest = { revision: 3, images: [], imports: {} };
    apiPatch.mockRejectedValue(new ApiError('x', 409, { detail: { message: 'm', current } }));
    const err = await patchExemplarImages('w1', 'a1b2c3', 2, [], 'tok').catch(e => e);
    expect(err).toBeInstanceOf(ManifestConflictError);
    expect(err.current.revision).toBe(3);
  });

  it('muu viga läbib muutmata', async () => {
    apiPatch.mockRejectedValue(new ApiError('x', 500));
    const err = await patchExemplarImages('w1', 'a1b2c3', 2, [], 'tok').catch(e => e);
    expect(err).not.toBeInstanceOf(ManifestConflictError);
  });
});
