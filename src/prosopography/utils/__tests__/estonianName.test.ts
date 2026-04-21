import { describe, expect, it } from 'vitest';
import { formatRelationOwnerName, formatRelationTypeLabel } from '../estonianName';

describe('formatRelationOwnerName', () => {
  it("adds 'i in Estonian when the name ends with a consonant", () => {
    expect(formatRelationOwnerName('Sven Dimberg', 'et')).toBe("Sven Dimberg'i");
    expect(formatRelationOwnerName('Andreas Dimbodius', 'et')).toBe("Andreas Dimbodius'i");
  });

  it('keeps Estonian names ending with a vowel unchanged', () => {
    expect(formatRelationOwnerName('Anna Maria', 'et')).toBe('Anna Maria');
    expect(formatRelationOwnerName('Jüri', 'et')).toBe('Jüri');
  });

  it('does not change names in other UI languages', () => {
    expect(formatRelationOwnerName('Sven Dimberg', 'en')).toBe('Sven Dimberg');
  });
});

describe('formatRelationTypeLabel', () => {
  it('uses the relation type label for the active language', () => {
    expect(formatRelationTypeLabel('isa', { et: 'isa', en: 'father' }, 'en')).toBe('father');
    expect(formatRelationTypeLabel('father', { et: 'isa', en: 'father' }, 'et')).toBe('isa');
  });

  it('falls back to English and then stored type', () => {
    expect(formatRelationTypeLabel('isa', { en: 'father' }, 'de')).toBe('father');
    expect(formatRelationTypeLabel('isa', null, 'en')).toBe('isa');
  });
});
