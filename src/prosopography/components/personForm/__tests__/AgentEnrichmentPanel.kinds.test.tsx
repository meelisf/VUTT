/** @vitest-environment jsdom */
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import '../../relations/__tests__/testI18n';
import type { ProsopoRecord } from '../../../types';

// #834: sünni, surma, päritolu, soo ja eluloo read ülevaatuspaneelis.
const { list, apply, reject, titles } = vi.hoisted(() => ({
  list: vi.fn(), apply: vi.fn(), reject: vi.fn(), titles: vi.fn(),
}));
vi.mock('../../../services/prosopographyService', async () => {
  const actual = await vi.importActual<typeof import('../../../services/prosopographyService')>(
    '../../../services/prosopographyService');
  return {
    EnrichmentApplyError: actual.EnrichmentApplyError,
    listEnrichmentProposals: list,
    applyEnrichmentProposal: apply, rejectEnrichmentProposal: reject, getWorkTitles: titles,
  };
});
import AgentEnrichmentPanel from '../AgentEnrichmentPanel';

const person = { id: 'vutt:Pabc', updated_at: 'v1', occupations: [], education: [] } as unknown as ProsopoRecord;
const ev = [{ source_kind: 'vutt_page', work_id: 'w1', page: 3 }];
const proposal = {
  proposal_id: 'p1', person_id: person.id, revision: 'rev1', base_updated_at: 'v0', created_at: 1, expires_at: 9999999999,
  items: [
    { kind: 'birth', date: { date: '1755', precision: 'year' }, evidence: ev,
      review_state: { state: 'conflict', current: { date: '1754', precision: 'year' } } },
    { kind: 'origin', place_key: 'tartu', registry_labels: { place_key: 'Tartu' }, evidence: ev,
      review_state: { state: 'applicable' } },
    { kind: 'biography', lang: 'et', base_hash: 'abcdefabcdef', text: 'Vana lause ja uus lisandus.',
      sources_add: [{ text: 'Levitski 1902: 106' }],
      review_state: { state: 'replace', current: 'Vana lause.' } },
    { kind: 'gender', value: 'M', evidence: ev, review_state: { state: 'blocked', reason: 'stale_biography' } },
  ],
};

const renderPanel = () => render(<MemoryRouter>
  <AgentEnrichmentPanel person={person} token="tok" isDirty={false} onApplied={vi.fn()} /></MemoryRouter>);

beforeEach(() => {
  for (const fn of [list, apply, reject, titles]) fn.mockReset();
  list.mockResolvedValue([proposal]);
  titles.mockResolvedValue({ w1: { title: 'Oratio', year: 1801, restricted: false } });
  apply.mockResolvedValue({ ...person, updated_at: 'v2' });
});

describe('isikukaardi väljade read', () => {
  it('konflikt näitab praegust ja pakutud väärtust; päritolu registri sildiga', async () => {
    renderPanel();
    expect(await screen.findByText('Sünd')).toBeTruthy();
    expect(screen.getByText(/1754/)).toBeTruthy();
    expect(screen.getByText(/1755/)).toBeTruthy();
    expect(screen.getByText('erineb kaardist')).toBeTruthy();
    expect(screen.getByText('Tartu')).toBeTruthy();
    expect(screen.getAllByRole('button', { name: 'Asenda' })).toHaveLength(2);   // konflikt + eluloo asendus
  });

  it('elulugu näitab sõnataseme erinevust ja lisatavaid allikaid', async () => {
    const { container } = renderPanel();
    fireEvent.click(await screen.findByText('Näita erinevust'));
    const inserted = [...container.querySelectorAll('.bg-green-100')].map(e => e.textContent).join('');
    expect(inserted).toContain('uus');
    expect(screen.getByText('Levitski 1902: 106')).toBeTruthy();
  });

  it('blokeeritud rida (vananenud elulugu) ei ole „Kinnita kõik" valikus', async () => {
    renderPanel();
    expect(await screen.findByText(/Elulugu on vahepeal muutunud/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Kinnita kõik (3)' }));
    await waitFor(() => expect(apply).toHaveBeenCalledWith(person.id, 'p1', [0, 1, 2], 'tok', 'rev1'));
  });
});
