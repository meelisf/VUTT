/** @vitest-environment jsdom */
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import '../../relations/__tests__/testI18n';
import type { ProsopoRecord } from '../../../types';

const { handoff, list, apply, search } = vi.hoisted(() => ({
  handoff: vi.fn(), list: vi.fn(), apply: vi.fn(), search: vi.fn(),
}));
vi.mock('../../../services/prosopographyService', () => ({
  createEnrichmentHandoff: handoff,
  listEnrichmentProposals: list,
  applyEnrichmentProposal: apply,
  searchEnrichmentRegistry: search,
}));
vi.mock('../DateField', () => ({
  default: ({ value, onChange }: { value: { year: string }; onChange: (value: { year: string }) => void }) =>
    <input placeholder="aasta" value={value.year} onChange={event => onChange({ ...value, year: event.target.value })} />,
}));
import AgentEnrichmentPanel from '../AgentEnrichmentPanel';

const person = {
  id: 'vutt:Pabc', updated_at: 'version-1',
  occupations: [{ label: 'Õpetaja', id: null }], education: [],
} as unknown as ProsopoRecord;
const proposal = {
  proposal_id: 'proposal-1', person_id: person.id, base_updated_at: person.updated_at,
  created_at: 1, expires_at: 9999999999,
  items: [{ kind: 'education', match_status: 'matched', raw_institution: 'Academia Gustaviana',
    institution_variant: 'AGC',
    evidence: [{ source_kind: 'literature', source_id: 'book1', locator: 'lk 4', quote: 'studiosus' }] }],
};

beforeEach(() => {
  handoff.mockReset(); list.mockReset(); apply.mockReset(); search.mockReset();
  list.mockResolvedValue([proposal]);
  handoff.mockResolvedValue({ code: 'one-time-code', expires_at: 9999999999 });
  apply.mockResolvedValue({ ...person, updated_at: 'version-2' });
  search.mockResolvedValue({ kind: 'institution', query: 'AGC', registry_available: true,
    ambiguous: false, truncated: false, total_matches: 1,
    results: [{ key: 'agc', id: null, labels: { et: 'Academia Gustaviana' },
      match_kind: 'variant', matched_text: 'AGC', matched_variant: 'AGC', place_key: 'tartu' }] });
});

describe('agendi ettepanekud isikuvormis', () => {
  it('näitab koodi, tõendit ja kinnitab ainult märgitud rea', async () => {
    const onApplied = vi.fn();
    render(<MemoryRouter><AgentEnrichmentPanel person={person} token="editor-token" isDirty={false} onApplied={onApplied} /></MemoryRouter>);
    expect(await screen.findByText('studiosus')).toBeTruthy();
    expect(screen.getByText('Tabanud nimevariant: AGC')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Loo üleandmiskood' }));
    expect(await screen.findByText('one-time-code')).toBeTruthy();
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: 'Kinnita valitud kirjed (1)' }));
    await waitFor(() => expect(apply).toHaveBeenCalledWith(person.id, 'proposal-1', [0], 'editor-token', {}));
    expect(onApplied).toHaveBeenCalledWith(expect.objectContaining({ updated_at: 'version-2' }));
  });

  it('ei luba salvestamata vormi ega puuduva registriseosega rida kinnitada', async () => {
    list.mockResolvedValue([{ ...proposal, items: [{ ...proposal.items[0], review_error: 'unknown_institution_key' }] }]);
    render(<MemoryRouter><AgentEnrichmentPanel person={person} token="editor-token" isDirty={true} onApplied={vi.fn()} /></MemoryRouter>);
    expect(await screen.findByText(/unknown_institution_key/)).toBeTruthy();
    expect((screen.getByRole('checkbox') as HTMLInputElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'Loo üleandmiskood' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('lubab mitmetähendusliku asutuse vaste toimetajal registrist valida', async () => {
    list.mockResolvedValue([{ ...proposal, items: [{ ...proposal.items[0],
      match_status: 'ambiguous', raw_institution: 'AGC', institution_variant: undefined }] }]);
    render(<MemoryRouter><AgentEnrichmentPanel person={person} token="editor-token" isDirty={false} onApplied={vi.fn()} /></MemoryRouter>);
    expect(await screen.findByText(/Mitu võimalikku vastet|Mitmetähenduslik vaste/)).toBeTruthy();
    expect((screen.getByRole('checkbox') as HTMLInputElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Otsi asutuste registrist' }));
    fireEvent.click(await screen.findByRole('button', { name: /Academia Gustaviana \(agc\)/ }));
    expect((screen.getByRole('checkbox') as HTMLInputElement).disabled).toBe(false);
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: 'Kinnita valitud kirjed (1)' }));
    await waitFor(() => expect(apply).toHaveBeenCalledWith(person.id, 'proposal-1', [0], 'editor-token', {
      0: { institution_key: 'agc', institution_variant: 'AGC', place_key: null },
    }));
  });

  it('saadab kuupäeva ja allikakoha paranduse ainult valitud reale', async () => {
    render(<MemoryRouter><AgentEnrichmentPanel person={person} token="editor-token" isDirty={false} onApplied={vi.fn()} /></MemoryRouter>);
    expect(await screen.findByText('studiosus')).toBeTruthy();
    fireEvent.click(screen.getByText('Paranda aeg või tõend'));
    fireEvent.change(screen.getAllByPlaceholderText('aasta')[0], { target: { value: '1641' } });
    fireEvent.change(screen.getByLabelText('Allikakoht'), { target: { value: 'lk 14' } });
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: 'Kinnita valitud kirjed (1)' }));
    await waitFor(() => expect(apply).toHaveBeenCalledWith(person.id, 'proposal-1', [0], 'editor-token', {
      0: { date_from: { date: '1641-01-01', precision: 'year', is_circa: false },
        evidence: [{ source_kind: 'literature', source_id: 'book1', locator: 'lk 14', quote: 'studiosus' }] },
    }));
  });
});
