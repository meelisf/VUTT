import { describe, it, expect } from 'vitest';
import { selectionScopeFrom } from '../useSelectionScope';

describe('selectionScopeFrom', () => {
  it('kõik teosed = piiramata ulatus, kohe valmis', () => {
    expect(selectionScopeFrom({ kind: 'all' }, null))
      .toEqual({ scope: undefined, ready: true, error: null });
  });

  it('püsikogu annab id-stringi (tagasiühilduv kuju)', () => {
    expect(selectionScopeFrom({ kind: 'collection', id: 'klingeriana' }, null))
      .toEqual({ scope: 'klingeriana', ready: true, error: null });
  });

  it('töökollektsioon EI OLE valmis enne ID-loendit', () => {
    const r = selectionScopeFrom({ kind: 'work_set', id: 'ws_1' }, null);
    expect(r.ready).toBe(false);
    // Kriitiline: laadimise ajal ei tohi ulatus olla „piiramata ja valmis" —
    // siis teeks kutsuja päringu kogu korpuse peale.
    expect(r.scope).toBeUndefined();
  });

  it('laetud loend annab valmis ulatuse', () => {
    expect(selectionScopeFrom({ kind: 'work_set', id: 'ws_1' }, ['a']))
      .toEqual({ scope: { selection: { kind: 'work_set', id: 'ws_1' }, workSetIds: ['a'] },
                 ready: true, error: null });
  });

  it('tühi loend on valmis — tühi kogu on kehtiv olek', () => {
    const r = selectionScopeFrom({ kind: 'work_set', id: 'ws_1' }, []);
    expect(r.ready).toBe(true);
    expect(r.scope).toEqual({ selection: { kind: 'work_set', id: 'ws_1' }, workSetIds: [] });
  });
});
