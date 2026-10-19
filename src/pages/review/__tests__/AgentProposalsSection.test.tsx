/** @vitest-environment jsdom */
// #641: Review lehe „Agendi ettepanekud" — pakkide loend ja kood kõigile teostele.
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import AgentProposalsSection from '../AgentProposalsSection';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string, o?: Record<string, unknown>) => (o ? `${k}:${JSON.stringify(o)}` : k) }),
}));
const svc = vi.hoisted(() => ({ listPacks: vi.fn() }));
vi.mock('../../../services/textProposalService', () => svc);

const PACK = {
  proposal_id: 'p1', work_id: 'w1', note: 'kustosed', username: 'agent', created_at: 1_700_000_000,
  counts: { pending: 1, stale: 1, accepted: 2, rejected: 0 },
  pages: [{ stem: 't-002', page_no: 2, state: 'accepted' }, { stem: 't-005', page_no: 5, state: 'stale' },
    { stem: 't-009', page_no: 9, state: 'pending' }],
};

const renderIt = () => render(
  <MemoryRouter initialEntries={['/review']}>
    <Routes>
      <Route path="/review" element={<AgentProposalsSection token="t" />} />
      <Route path="/work/:id/:page" element={<div>LEHT</div>} />
    </Routes>
  </MemoryRouter>,
);

beforeEach(() => { svc.listPacks.mockReset(); });

describe('AgentProposalsSection', () => {
  it('loendi rida viib esimesele ülevaatust vajavale lehele', async () => {
    svc.listPacks.mockResolvedValue([PACK]);
    renderIt();
    fireEvent.click(await screen.findByText(/kustosed/));
    expect(await screen.findByText('LEHT')).toBeTruthy();
  });
});
