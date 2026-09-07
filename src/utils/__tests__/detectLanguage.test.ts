import { describe, it, expect } from 'vitest';
import { detectInitialLanguage } from '../detectLanguage';

describe('detectInitialLanguage', () => {
  it('kirjast tulnud ?lang on kaalukaim (#298)', () => {
    // Kutsekirja saaja avab lingi oma brauseris, mille keel on hoopis kolmas.
    // Kiri oli tema valitud keeles — sama keel peab jätkuma ka lehel.
    expect(detectInitialLanguage('et', ['et-EE'], 'en')).toBe('en');
    expect(detectInitialLanguage('en', ['en-US'], 'et')).toBe('et');
  });

  it('toetamata ?lang ei kaaperda tuvastust', () => {
    expect(detectInitialLanguage(null, ['et-EE'], 'de')).toBe('et');
    expect(detectInitialLanguage('en', ['et'], '')).toBe('en');
    expect(detectInitialLanguage(null, ['et'], null)).toBe('et');
  });

  it('?lang normaliseeritakse nagu brauseri keel', () => {
    expect(detectInitialLanguage(null, ['et'], 'EN-us')).toBe('en');
  });

  it('käsitsi valik localStorage-is on kaalukaim', () => {
    expect(detectInitialLanguage('et', ['en-US', 'en'])).toBe('et');
    expect(detectInitialLanguage('en', ['et-EE', 'et'])).toBe('en');
  });

  it('ignoreerib toetamata salvestatud väärtust', () => {
    expect(detectInitialLanguage('de', ['et-EE'])).toBe('et');
    expect(detectInitialLanguage('', ['et'])).toBe('et');
  });

  it('eesti brauser saab eesti keele', () => {
    expect(detectInitialLanguage(null, ['et-EE', 'et'])).toBe('et');
    expect(detectInitialLanguage(null, ['et'])).toBe('et');
  });

  it('piirkonnakood eemaldatakse ja suurtähed ei sega', () => {
    expect(detectInitialLanguage(null, ['ET-ee'])).toBe('et');
    expect(detectInitialLanguage(null, ['en-GB'])).toBe('en');
  });

  it('muu keel langeb inglise peale', () => {
    expect(detectInitialLanguage(null, ['de-DE', 'fr'])).toBe('en');
    expect(detectInitialLanguage(null, ['ru'])).toBe('en');
  });

  it('võtab esimese toetatud vaste järjekorras', () => {
    // Brauser eelistab saksa keelt, aga eesti on nimekirjas enne inglist
    expect(detectInitialLanguage(null, ['de', 'et', 'en'])).toBe('et');
    expect(detectInitialLanguage(null, ['de', 'en', 'et'])).toBe('en');
  });

  it('tühi või puuduv brauseri nimekiri annab inglise keele', () => {
    expect(detectInitialLanguage(null, [])).toBe('en');
    expect(detectInitialLanguage(null, undefined)).toBe('en');
  });

  it('ei komistata mitte-string kirjete otsa', () => {
    expect(detectInitialLanguage(null, [undefined as any, null as any, 'et'])).toBe('et');
  });
});
