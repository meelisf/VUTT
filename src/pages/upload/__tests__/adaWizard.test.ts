import { describe, it, expect } from 'vitest';
import { adaSammuOlek, ADA_TRANSFER_STATUSES } from '../constants';

describe('ADA staatuste marsruutimine', () => {
  it('ada_fetching kuulub 2. sammu, mitte 3. sammu', () => {
    expect(adaSammuOlek('ada_fetching')).toBe(2);
  });

  it('ada_error kuulub samuti 2. sammu (seal on "Laen uuesti")', () => {
    expect(adaSammuOlek('ada_error')).toBe(2);
  });

  it('awaiting_split viib 3. sammu', () => {
    expect(adaSammuOlek('awaiting_split')).toBe(3);
  });

  it('ada_fetching EI OLE prepress-staatus', () => {
    // Muidu viskaks polling admini poolitamise vaatesse keset allalaadimist.
    expect(ADA_TRANSFER_STATUSES).toContain('ada_fetching');
  });
});
