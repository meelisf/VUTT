import { describe, expect, it } from 'vitest';
import { isAbortError } from '../isAbortError';

describe('isAbortError', () => {
  it('tunneb ära fetch-i katkestuse (DOMException)', () => {
    expect(isAbortError(new DOMException('aborted', 'AbortError'))).toBe(true);
  });

  it('tunneb ära katkestuse ka siis, kui DOMException-it ei ole (testikeskkond, vanem jsdom)', () => {
    expect(isAbortError({ name: 'AbortError' })).toBe(true);
  });

  it('päris viga EI OLE katkestus — muidu kaoks tõeline ebaõnnestumine ära', () => {
    expect(isAbortError(new Error('HTTP 500'))).toBe(false);
    expect(isAbortError({ name: 'TypeError' })).toBe(false);
    expect(isAbortError(null)).toBe(false);
    expect(isAbortError(undefined)).toBe(false);
    expect(isAbortError('AbortError')).toBe(false);
  });
});
