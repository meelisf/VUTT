import { describe, expect, it } from 'vitest';
import { backTarget } from '../WorkspaceBackButton';

// Tagasinupp (#587 samm 4): näidatakse ainult siis, kui teosele tuldi
// nimekirjast või otsingust. Lingiga tulles tagasiteed sessioonis ei ole.
describe('backTarget', () => {
  it('lingiga tulles nuppu ei ole', () => {
    expect(backTarget(null)).toBeNull();
    expect(backTarget('')).toBeNull();
  });

  it('esileht koos filtritega on nimekiri', () => {
    expect(backTarget('/')).toBe('list');
    expect(backTarget('/?collection=universitas-dorpatensis-1&page=3')).toBe('list');
  });

  it('täisteksti otsing on oma silt', () => {
    expect(backTarget('/search?q=Menius')).toBe('search');
  });

  it('tundmatu siht ei saa eksitavat silti', () => {
    expect(backTarget('/persons/vutt:P1')).toBeNull();
    expect(backTarget('/searchx')).toBeNull();
  });
});
