import { describe, expect, it } from 'vitest';
import { defaultRegistrationLanguage } from '../registerLanguage';

describe('defaultRegistrationLanguage', () => {
  it('võtab UI keele, kui see on toetatud', () => {
    expect(defaultRegistrationLanguage('en')).toBe('en');
    expect(defaultRegistrationLanguage('et')).toBe('et');
  });

  it('kärbib piirkonna: brauseri i18n.language võib olla en-GB', () => {
    expect(defaultRegistrationLanguage('en-GB')).toBe('en');
    expect(defaultRegistrationLanguage('et-EE')).toBe('et');
  });

  it('langeb toetamata või puuduva keele korral eesti keelele', () => {
    expect(defaultRegistrationLanguage('de')).toBe('et');
    expect(defaultRegistrationLanguage('')).toBe('et');
    expect(defaultRegistrationLanguage(undefined)).toBe('et');
  });
});
