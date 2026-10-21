/** @vitest-environment jsdom */
// `/review` link pakile, mille lehed on teosest kadunud: riba ütleb seda ja pakki saab tagasi lükata.
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import TextProposalPanel from '../TextProposalPanel';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));

const pack = {
  proposal_id: 'p', work_id: 'w', note: '', username: 'a', created_at: 0,
  counts: { pending: 1, stale: 0, accepted: 0, rejected: 0 }, pages: [],
};
const noop = () => {};
const props = {
  review: null, pack, pendingNotLoaded: false, loaded: false, job: null, error: null,
  onLoad: noop, onReject: noop, onRejectPack: noop, onAcceptPack: noop, onSaveAndNext: noop,
  onPrev: null, onNext: null,
};

describe('TextProposalPanel', () => {
  it('paki lehed kadunud → teade ja tagasilükkamise nupp', () => {
    render(<TextProposalPanel {...props} packPagesGone />);
    expect(screen.getByText('proposal.packPagesGone')).toBeTruthy();
    expect(screen.getByText('proposal.rejectPack')).toBeTruthy();
  });
  it('tavaolukorras teadet ei ole', () => {
    render(<TextProposalPanel {...props} packPagesGone={false} />);
    expect(screen.queryByText('proposal.packPagesGone')).toBeNull();
  });
});
