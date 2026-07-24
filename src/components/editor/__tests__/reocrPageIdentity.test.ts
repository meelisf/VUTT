import { describe, it, expect } from 'vitest';
import { reocrPageIdentity } from '../reocrPageIdentity';

describe('reocrPageIdentity', () => {
  it('eristab sama teose leheküljed', () => {
    const a = reocrPageIdentity('w1', 'http://x/images/w1/foo_pg_001.jpg');
    const b = reocrPageIdentity('w1', 'http://x/images/w1/foo_pg_002.jpg');
    expect(a.pageKey).not.toBe(b.pageKey);
    expect(a.storageKey).not.toBe(b.storageKey);
  });

  it('sama leht annab sama võtme', () => {
    const a = reocrPageIdentity('w1', 'http://x/images/w1/foo_pg_001.jpg');
    const b = reocrPageIdentity('w1', 'http://x/images/w1/foo_pg_001.jpg');
    expect(a.pageKey).toBe(b.pageKey);
  });

  it('eristab sama failinimega lehed eri teostes', () => {
    const a = reocrPageIdentity('w1', 'http://x/images/w1/pg_001.jpg');
    const b = reocrPageIdentity('w2', 'http://x/images/w2/pg_001.jpg');
    expect(a.pageKey).not.toBe(b.pageKey);
  });

  it('säilitab ajaloolise localStorage võtme formaadi', () => {
    // NB: pooleliolevad tööd on juba salvestatud selle võtmega — ära muuda.
    expect(reocrPageIdentity('w1', '/img/foo_pg_001.jpg').storageKey)
      .toBe('reocr_job_w1_foo_pg_001.jpg');
  });

  it('ilma pildi või teoseta võtit pole', () => {
    expect(reocrPageIdentity('w1', null).pageKey).toBeNull();
    expect(reocrPageIdentity(null, '/img/foo.jpg').pageKey).toBeNull();
    expect(reocrPageIdentity('w1', null).storageKey).toBeNull();
  });
});
