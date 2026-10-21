import { describe, expect, it } from 'vitest';
import { parseServerDate } from '../formatDateTime';

describe('parseServerDate', () => {
  it('ajavööndita ISO-aeg loetakse UTC-na (konteiner jookseb UTC-s)', () => {
    expect(parseServerDate('2026-10-21T11:36:18.123456').toISOString()).toBe('2026-10-21T11:36:18.123Z');
    expect(parseServerDate('2026-10-21T11:36').toISOString()).toBe('2026-10-21T11:36:00.000Z');
  });

  it('nihkega aeg jääb puutumata', () => {
    expect(parseServerDate('2026-10-21T11:36:18+00:00').toISOString()).toBe('2026-10-21T11:36:18.000Z');
    expect(parseServerDate('2026-10-21T14:36:18+03:00').toISOString()).toBe('2026-10-21T11:36:18.000Z');
    expect(parseServerDate('2026-10-21T11:36:18Z').toISOString()).toBe('2026-10-21T11:36:18.000Z');
  });
});
