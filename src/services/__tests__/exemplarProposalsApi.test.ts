import { describe, expect, it } from 'vitest';
import { esterRecordUrl } from '../exemplarProposalsApi';

describe('esterRecordUrl', () => {
  it('koostab ESTERi kirje lingi numbrist (agent URL-i ei anna)', () => {
    expect(esterRecordUrl('b2648642')).toBe('https://www.ester.ee/record=b2648642*est');
  });
  it('kodeerib ootamatu sisendi', () => {
    expect(esterRecordUrl('b1/../x')).toBe('https://www.ester.ee/record=b1%2F..%2Fx*est');
  });
});
