import { describe, it, expect } from 'vitest';
import { createLatestRequest, needsPageLoad, pageLoadKey } from '../workspacePageLoad';

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

describe('ainult viimane lehepäring kehtib', () => {
  it('hiljem saabunud vanema lehe vastus ei kehti (ruudustikust kiire valik)', () => {
    const latest = createLatestRequest();
    const lehtA = latest.begin();
    const lehtB = latest.begin();
    // B vastas enne, A alles nüüd — A ei tohi B-d üle kirjutada
    expect(latest.isCurrent(lehtB)).toBe(true);
    expect(latest.isCurrent(lehtA)).toBe(false);
  });

  it('tagasi juba laetud lehele: pooleli päring tühistatakse ilma uueta', () => {
    // A laetud → B päring käib → kasutaja läheb A-le tagasi (laadimist pole vaja)
    const latest = createLatestRequest();
    const lehtB = latest.begin();
    latest.invalidate();
    expect(latest.isCurrent(lehtB)).toBe(false);
  });
});
