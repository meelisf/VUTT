/** @vitest-environment jsdom */
import { describe, it, expect } from 'vitest';
import { dotIcon, pieIcon } from '../mapIcons';

describe('kaardi ikoonid korduskasutatakse', () => {
  it('samad argumendid → sama objekt (react-leaflet ei kutsu setIcon-it igal renderdusel)', () => {
    expect(dotIcon(3, '#1d2126')).toBe(dotIcon(3, '#1d2126'));
    expect(pieIcon({ academic: 1, cotext: 2 }, 3)).toBe(pieIcon({ cotext: 2, academic: 1 }, 3));
    expect(dotIcon(3, '#1d2126')).not.toBe(dotIcon(4, '#1d2126'));
  });
});
