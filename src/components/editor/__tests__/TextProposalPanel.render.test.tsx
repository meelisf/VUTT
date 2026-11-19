/** @vitest-environment jsdom */
// `/review` link pakile, mille lehed on teosest kadunud: riba ütleb seda ja pakki saab tagasi lükata.
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
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
  onPrev: null, onNext: null, onOpenStale: null,
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

  it('ainult aegunud lehed → paki kinnitust ei pakuta, viide käsitsi ülevaatusele', () => {
    const onOpenStale = vi.fn();
    const stalePack = { ...pack, counts: { pending: 0, stale: 1, accepted: 2, rejected: 0 } };
    render(<TextProposalPanel {...props} pack={stalePack} packPagesGone={false} onOpenStale={onOpenStale} />);
    expect(screen.queryByText('proposal.acceptPack')).toBeNull();
    expect(screen.getByText('proposal.rejectPack')).toBeTruthy();
    expect(screen.getByText('proposal.staleOnly')).toBeTruthy();
    fireEvent.click(screen.getByText('proposal.openStale'));
    expect(onOpenStale).toHaveBeenCalled();
  });
  it('ootel lehed → kinnitusnupp, aegunute viidet ei ole', () => {
    const mixed = { ...pack, counts: { pending: 2, stale: 1, accepted: 0, rejected: 0 } };
    render(<TextProposalPanel {...props} pack={mixed} packPagesGone={false} />);
    expect(screen.getByText('proposal.acceptPack')).toBeTruthy();
    expect(screen.queryByText('proposal.staleOnly')).toBeNull();
  });
});
