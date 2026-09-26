/** @vitest-environment jsdom */
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import '../../relations/__tests__/testI18n';
import type { ProsopoRecord } from '../../../types';

const { handoff, list, apply } = vi.hoisted(() => ({
  handoff: vi.fn(), list: vi.fn(), apply: vi.fn(),
}));
vi.mock('../../../services/prosopographyService', () => ({
  createEnrichmentHandoff: handoff,
  listEnrichmentProposals: list,
  applyEnrichmentProposal: apply,
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
    evidence: [{ source_kind: 'literature', source_id: 'book1', locator: 'lk 4', quote: 'studiosus' }] }],
};

beforeEach(() => {
  handoff.mockReset(); list.mockReset(); apply.mockReset();
  list.mockResolvedValue([proposal]);
  handoff.mockResolvedValue({ code: 'one-time-code', expires_at: 9999999999 });
  apply.mockResolvedValue({ ...person, updated_at: 'version-2' });
});

describe('agendi ettepanekud isikuvormis', () => {
  it('näitab koodi, tõendit ja kinnitab ainult märgitud rea', async () => {
    const onApplied = vi.fn();
    render(<MemoryRouter><AgentEnrichmentPanel person={person} token="editor-token" isDirty={false} onApplied={onApplied} /></MemoryRouter>);
    expect(await screen.findByText('studiosus')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Loo üleandmiskood' }));
    expect(await screen.findByText('one-time-code')).toBeTruthy();
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: 'Kinnita valitud kirjed (1)' }));
    await waitFor(() => expect(apply).toHaveBeenCalledWith(person.id, 'proposal-1', [0], 'editor-token'));
    expect(onApplied).toHaveBeenCalledWith(expect.objectContaining({ updated_at: 'version-2' }));
  });

  it('ei luba salvestamata vormi ega puuduva registriseosega rida kinnitada', async () => {
    list.mockResolvedValue([{ ...proposal, items: [{ ...proposal.items[0], review_error: 'unknown_institution_key' }] }]);
    render(<MemoryRouter><AgentEnrichmentPanel person={person} token="editor-token" isDirty={true} onApplied={vi.fn()} /></MemoryRouter>);
    expect(await screen.findByText(/unknown_institution_key/)).toBeTruthy();
    expect((screen.getByRole('checkbox') as HTMLInputElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'Loo üleandmiskood' }) as HTMLButtonElement).disabled).toBe(true);
  });
});
