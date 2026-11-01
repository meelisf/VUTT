/** @vitest-environment jsdom */
// Review lehe „Agendi ettepanekud" (ADR 0058, 2026-10-20): ühtne loend kolmest
// hoidlast + üks agendikood. Rida viib serveri antud sihtlingile.
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import AgentProposalsSection from '../AgentProposalsSection';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string, o?: Record<string, unknown>) => (o ? `${k}:${JSON.stringify(o)}` : k) }),
}));
const svc = vi.hoisted(() => ({ listAgentProposals: vi.fn(), createAgentHandoff: vi.fn() }));
vi.mock('../../../services/agentProposalsService', () => svc);

const TEXT = {
  kind: 'text', proposal_id: 'p1', target_id: 'w1', target_label: 'Epistolae',
  target_url: '/work/w1/4?proposal=p1', pending: 1, stale: 2, created_at: 1_700_000_000,
};
const PARTS = {
  kind: 'parts', proposal_id: 'p2', target_id: 'w1', target_label: 'Epistolae',
  target_url: '/work/w1/manage?tab=parts', pending: 2, stale: 2, created_at: 1_700_000_000,
};
const PERSON = {
  kind: 'person', proposal_id: 'p3', target_id: 'vutt:Pabc', target_label: 'Johann Fischer',
  target_url: '/persons/vutt:Pabc/edit?agent=1', pending: 3, stale: null, created_at: 1_700_000_000,
};

const EXEMPLARS = {
  kind: 'exemplars', proposal_id: 'p4', target_id: 'w1', target_label: 'Das Bild',
  target_url: '/work/w1/manage?tab=exemplars', pending: 2, stale: 1, created_at: 1_700_000_000,
};

function Leht() {
  const loc = useLocation();
  return <div>LEHT {loc.search}</div>;
}

const renderIt = () => render(
  <MemoryRouter initialEntries={['/review']}>
    <Routes>
      <Route path="/review" element={<AgentProposalsSection token="t" />} />
      <Route path="/work/:id/:page" element={<Leht />} />
    </Routes>
  </MemoryRouter>,
);

const tick = () => new Promise(r => setTimeout(r, 0));

beforeEach(() => {
  svc.listAgentProposals.mockReset();
  svc.createAgentHandoff.mockReset();
});

describe('AgentProposalsSection', () => {
  it('rida viib serveri antud target_url-ile', async () => {
    svc.listAgentProposals.mockResolvedValue([TEXT]);
    renderIt();
    fireEvent.click(await screen.findByText('Epistolae'));
    expect(await screen.findByText('LEHT ?proposal=p1')).toBeTruthy();
  });

  it('isiku real ei ole vananemist', async () => {
    svc.listAgentProposals.mockResolvedValue([PERSON]);
    const { container } = renderIt();
    await screen.findByText('Johann Fischer');
    expect(container.textContent).toContain('proposals.kind.person');
    expect(container.textContent).not.toContain('proposals.stale');
    expect(container.textContent).not.toContain('proposals.pagesChanged');
  });

  it('osade vananemine on märk, mitte arv', async () => {
    svc.listAgentProposals.mockResolvedValue([PARTS]);
    const { container } = renderIt();
    await screen.findByText('Epistolae');
    expect(container.textContent).toContain('proposals.pagesChanged');
    expect(container.textContent).not.toContain('proposals.stale');
  });

  it('teksti vananemine on arv', async () => {
    svc.listAgentProposals.mockResolvedValue([TEXT]);
    const { container } = renderIt();
    await screen.findByText('Epistolae');
    expect(container.textContent).toContain('proposals.stale:{"count":2}');
  });

  it('eksemplaride rida: oma silt, mittekinnitatavate arv ja link haldusvaatesse (#703)', async () => {
    svc.listAgentProposals.mockResolvedValue([EXEMPLARS]);
    const { container } = render(
      <MemoryRouter initialEntries={['/review']}>
        <Routes>
          <Route path="/review" element={<AgentProposalsSection token="t" />} />
          <Route path="/work/:id/manage" element={<Leht />} />
        </Routes>
      </MemoryRouter>,
    );
    await screen.findByText('Das Bild');
    expect(container.textContent).toContain('proposals.kind.exemplars');
    // Topelt / registrist puuduv hoidja ei ole „aegunud" — eraldi märk
    expect(container.textContent).toContain('proposals.blocked:{"count":1}');
    expect(container.textContent).not.toContain('proposals.stale');
    fireEvent.click(screen.getByText('Das Bild'));
    expect(await screen.findByText('LEHT ?tab=exemplars')).toBeTruthy();
  });

  it('tühja loendi korral on koodinupp näha, loendit ei ole', async () => {
    svc.listAgentProposals.mockResolvedValue([]);
    const { container } = renderIt();
    await tick();
    expect(svc.listAgentProposals).toHaveBeenCalled();
    expect(screen.getByText('proposals.createCode')).toBeTruthy();
    expect(container.querySelector('ul')).toBeNull();
  });

  it('koodi loomine näitab koodi ja lage', async () => {
    svc.listAgentProposals.mockResolvedValue([]);
    svc.createAgentHandoff.mockResolvedValue({
      code: 'KOOD-123', expires_at: 1_700_000_000, max_uses: { text: 20, parts: 20, persons: 200, exemplars: 20 },
    });
    const { container } = renderIt();
    fireEvent.click(screen.getByText('proposals.createCode'));
    expect(await screen.findByText('KOOD-123')).toBeTruthy();
    expect(container.textContent).toContain('"text":20');
    expect(container.textContent).toContain('"persons":200');
    expect(container.textContent).toContain('"exemplars":20');
  });
});
