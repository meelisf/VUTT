// Ettepaneku riba ainult siis, kui on päris ettepanek (või paki töö tulemus/viga).
import { describe, expect, it } from 'vitest';
import { shouldShowProposalPanel } from '../TextProposalPanel';

const pack = (pending: number, stale = 0) => ({
  proposal_id: 'p', work_id: 'w', note: '', username: 'a', created_at: 0,
  counts: { pending, stale, accepted: 0, rejected: 0 }, pages: [],
});

describe('shouldShowProposalPanel', () => {
  it('ilma ettepanekuta peidus', () => {
    expect(shouldShowProposalPanel({ review: null, pack: null, job: null, error: null })).toBe(false);
    expect(shouldShowProposalPanel({ review: null, pack: pack(0), job: null, error: null })).toBe(false);
  });
  it('ootel pakk teoses, lehe ettepanek, töö või viga → nähtav', () => {
    expect(shouldShowProposalPanel({ review: null, pack: pack(1), job: null, error: null })).toBe(true);
    expect(shouldShowProposalPanel({ review: null, pack: pack(0, 1), job: null, error: null })).toBe(true);
    expect(shouldShowProposalPanel({ review: {} as never, pack: null, job: null, error: null })).toBe(true);
    expect(shouldShowProposalPanel({ review: null, pack: null, job: { state: 'done' }, error: null })).toBe(true);
    expect(shouldShowProposalPanel({ review: null, pack: null, job: null, error: 'x' })).toBe(true);
  });
});
