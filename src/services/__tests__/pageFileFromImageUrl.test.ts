import { describe, it, expect, vi } from 'vitest';

vi.mock('../../config', () => ({ IMAGE_BASE_URL: '/api/images' }));

import { getFullImageUrl, pageFileFromImageUrl } from '../workImageService';

describe('pageFileFromImageUrl', () => {
  it('täpitäht failinimes: URL-ist tuleb kettal olev nimi, mitte %C3%A4', () => {
    // z0kdh0 (2026-10-15): poolitus pani kaustanime (ä-ga) failinimesse → /save 404
    const path = '1633-Liefflä/1633-Liefflä-z0kdh0-0p3ks2.jpg';
    expect(pageFileFromImageUrl(getFullImageUrl(path))).toBe('1633-Liefflä-z0kdh0-0p3ks2.jpg');
  });
  it('ASCII nimi ei muutu', () => {
    expect(pageFileFromImageUrl(getFullImageUrl('kaust/r_acad_dorp_1633_34_0001.jpg'))).toBe('r_acad_dorp_1633_34_0001.jpg');
  });
  it('tühik ja protsendimärk failinimes tulevad tagasi algkujul', () => {
    expect(pageFileFromImageUrl(getFullImageUrl('k/a b 50%.jpg'))).toBe('a b 50%.jpg');
  });
  it('vigane kodeering → toores lõik (ei viska)', () => {
    expect(pageFileFromImageUrl('/api/images/k/x%E0%A4.jpg')).toBe('x%E0%A4.jpg');
  });
  it('tühi sisend → tühi', () => {
    expect(pageFileFromImageUrl('')).toBe('');
  });
});
