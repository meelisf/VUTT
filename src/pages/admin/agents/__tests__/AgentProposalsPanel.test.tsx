/** @vitest-environment jsdom */
// „Agendid" lehe paneel (ADR 0058, 2026-10-20; #869): ühtne loend kõigist
// hoidlatest + üks agendikood. Rida viib serveri antud sihtlingile.
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import AgentProposalsPanel from '../AgentProposalsPanel';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string, o?: Record<string, unknown>) => (o ? `${k}:${JSON.stringify(o)}` : k) }),
}));
const svc = vi.hoisted(() => ({ listAgentProposals: vi.fn(), createAgentHandoff: vi.fn() }));
vi.mock('../../../../services/agentProposalsService', () => svc);

const TEXT = {
  kind: 'text', proposal_id: 'p1', username: 'ed', target_id: 'w1', target_label: 'Epistolae',
  target_url: '/work/w1/4?proposal=p1', pending: 1, stale: 2, created_at: 1_700_000_000,
};
const PARTS = {
  kind: 'parts', proposal_id: 'p2', username: 'adm', target_id: 'w1', target_label: 'Epistolae',
  target_url: '/work/w1/manage?tab=parts', pending: 2, stale: 2, created_at: 1_700_000_000,
};
const PERSON = {
  kind: 'person', proposal_id: 'p3', username: 'ed', target_id: 'vutt:Pabc', target_label: 'Johann Fischer',
  target_url: '/persons/vutt:Pabc/edit?agent=1', pending: 3, stale: null, created_at: 1_700_000_000,
};

const EXEMPLARS = {
  kind: 'exemplars', proposal_id: 'p4', username: 'ed', target_id: 'w1', target_label: 'Das Bild',
  target_url: '/work/w1/manage?tab=exemplars', pending: 2, stale: 1, created_at: 1_700_000_000,
};

function Leht() {
  const loc = useLocation();
  return <div>LEHT {loc.search}</div>;
}

const renderIt = () => render(
  <MemoryRouter initialEntries={['/review']}>
    <Routes>
      <Route path="/review" element={<AgentProposalsPanel token="t" />} />
      <Route path="/work/:id/:page" element={<Leht />} />
    </Routes>
  </MemoryRouter>,
);

const tick = () => new Promise(r => setTimeout(r, 0));

beforeEach(() => {
  svc.listAgentProposals.mockReset();
  svc.createAgentHandoff.mockReset();
});

describe('AgentProposalsPanel', () => {
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
    expect(container.textContent).toContain('agents.kind.person');
    expect(container.textContent).not.toContain('agents.stale');
    expect(container.textContent).not.toContain('agents.pagesChanged');
  });

  it('osade vananemine on märk, mitte arv', async () => {
    svc.listAgentProposals.mockResolvedValue([PARTS]);
    const { container } = renderIt();
    await screen.findByText('Epistolae');
    expect(container.textContent).toContain('agents.pagesChanged');
    expect(container.textContent).not.toContain('agents.stale');
  });

  it('teksti vananemine on arv', async () => {
    svc.listAgentProposals.mockResolvedValue([TEXT]);
    const { container } = renderIt();
    await screen.findByText('Epistolae');
    expect(container.textContent).toContain('agents.stale:{"count":2}');
  });

  it('eksemplaride rida: oma silt, mittekinnitatavate arv ja link haldusvaatesse (#703)', async () => {
    svc.listAgentProposals.mockResolvedValue([EXEMPLARS]);
    const { container } = render(
      <MemoryRouter initialEntries={['/review']}>
        <Routes>
          <Route path="/review" element={<AgentProposalsPanel token="t" />} />
          <Route path="/work/:id/manage" element={<Leht />} />
        </Routes>
      </MemoryRouter>,
    );
    await screen.findByText('Das Bild');
    expect(container.textContent).toContain('agents.kind.exemplars');
    // Topelt / registrist puuduv hoidja ei ole „aegunud" — eraldi märk
    expect(container.textContent).toContain('agents.blocked:{"count":1}');
    expect(container.textContent).not.toContain('agents.stale');
    fireEvent.click(screen.getByText('Das Bild'));
    expect(await screen.findByText('LEHT ?tab=exemplars')).toBeTruthy();
  });

  it('tühja loendi korral on koodinupp näha, loendit ei ole', async () => {
    svc.listAgentProposals.mockResolvedValue([]);
    const { container } = renderIt();
    await tick();
    expect(svc.listAgentProposals).toHaveBeenCalled();
    expect(screen.getByText('agents.createCode')).toBeTruthy();
    expect(container.querySelector('ul')).toBeNull();
  });

  it('koodi loomine näitab koodi ja lage', async () => {
    svc.listAgentProposals.mockResolvedValue([]);
    svc.createAgentHandoff.mockResolvedValue({
      code: 'KOOD-123', expires_at: 1_700_000_000, max_uses: { text: 20, parts: 20, persons: 200, exemplars: 20 },
    });
    const { container } = renderIt();
    fireEvent.click(screen.getByText('agents.createCode'));
    expect(await screen.findByText('KOOD-123')).toBeTruthy();
    expect(container.textContent).toContain('"text":20');
    expect(container.textContent).toContain('"persons":200');
    expect(container.textContent).toContain('"exemplars":20');
  });

  it('tühi loend ütleb, et ootel ettepanekuid ei ole', async () => {
    svc.listAgentProposals.mockResolvedValue([]);
    renderIt();
    expect(await screen.findByText('agents.empty')).toBeTruthy();
  });

  it('adminile esitaja veergu ega filtrit ei näidata (#869)', async () => {
    svc.listAgentProposals.mockResolvedValue([TEXT, PARTS]);
    const { container } = renderIt();
    await screen.findAllByText('Epistolae');
    expect(container.querySelector('select')).toBeNull();
    expect(screen.queryByText('adm')).toBeNull();
  });

  it('superadmin filtreerib esitaja järgi (#869)', async () => {
    svc.listAgentProposals.mockResolvedValue([TEXT, PARTS, PERSON]);
    const { container } = render(
      <MemoryRouter initialEntries={['/admin/agents']}>
        <Routes>
          <Route path="/admin/agents" element={<AgentProposalsPanel token="t" showOwner />} />
        </Routes>
      </MemoryRouter>,
    );
    await screen.findByText('Johann Fischer');
    expect(container.querySelectorAll('li')).toHaveLength(3);
    const select = container.querySelector('select') as HTMLSelectElement;
    expect([...select.options].map(o => o.value)).toEqual(['', 'adm', 'ed']);
    fireEvent.change(select, { target: { value: 'adm' } });
    expect(container.querySelectorAll('li')).toHaveLength(1);
    expect(screen.queryByText('Johann Fischer')).toBeNull();
  });
});
