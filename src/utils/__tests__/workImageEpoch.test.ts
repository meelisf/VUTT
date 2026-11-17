/** @vitest-environment jsdom */
import { beforeEach, describe, expect, it } from 'vitest';
import { bumpWorkImageEpoch, getWorkImageEpoch, withWorkImageEpoch } from '../workImageEpoch';

describe('workImageEpoch', () => {
  beforeEach(() => sessionStorage.clear());

  it('muutmata teose URL jääb samaks (vahemälu kehtib edasi)', () => {
    expect(getWorkImageEpoch('w1')).toBeNull();
    expect(withWorkImageEpoch('/api/images/a/b.jpg', getWorkImageEpoch('w1'))).toBe('/api/images/a/b.jpg');
  });

  it('pärast pildimuutust saab sama lehe URL uue versiooni (kärbe → töölaud näeb uut pilti)', () => {
    const enne = withWorkImageEpoch('/api/images/a/b.jpg', getWorkImageEpoch('w1'));
    bumpWorkImageEpoch('w1', 1000);
    const parast = withWorkImageEpoch('/api/images/a/b.jpg', getWorkImageEpoch('w1'));
    expect(parast).toBe('/api/images/a/b.jpg?v=1000');
    expect(parast).not.toBe(enne);
    bumpWorkImageEpoch('w1', 2000);
    expect(withWorkImageEpoch('/x.jpg?exp=1', getWorkImageEpoch('w1'))).toBe('/x.jpg?exp=1&v=2000');
  });

  it('versioon on teosepõhine', () => {
    bumpWorkImageEpoch('w1', 1000);
    expect(getWorkImageEpoch('w2')).toBeNull();
  });

  it('katkine salvestis ei viska', () => {
    sessionStorage.setItem('vutt_work_image_epoch', '{katki');
    expect(getWorkImageEpoch('w1')).toBeNull();
    bumpWorkImageEpoch('w1', 5);
    expect(getWorkImageEpoch('w1')).toBe(5);
  });
});
