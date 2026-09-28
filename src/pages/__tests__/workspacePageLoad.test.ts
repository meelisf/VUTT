import { describe, it, expect } from 'vitest';
import { needsPageLoad, pageLoadKey } from '../workspacePageLoad';

describe('lehe laadimise võti', () => {
  it('sama leht (tokeni uuendus, uuesti sisselogimine) EI laadi uuesti', () => {
    const loaded = pageLoadKey('kkrxpe', 1, null);
    expect(needsPageLoad(loaded, pageLoadKey('kkrxpe', 1, null))).toBe(false);
  });

  it('teine leht, teine teos, viewer-token või laadimata leht laeb', () => {
    const loaded = pageLoadKey('kkrxpe', 1, null);
    expect(needsPageLoad(loaded, pageLoadKey('kkrxpe', 2, null))).toBe(true);
    expect(needsPageLoad(loaded, pageLoadKey('5fsswb', 1, null))).toBe(true);
    expect(needsPageLoad(loaded, pageLoadKey('kkrxpe', 1, 'vt'))).toBe(true);
    expect(needsPageLoad(null, pageLoadKey('kkrxpe', 1, null))).toBe(true);
  });
});
