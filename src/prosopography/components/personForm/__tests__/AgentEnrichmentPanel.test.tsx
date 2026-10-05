/** @vitest-environment jsdom */
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import '../../relations/__tests__/testI18n';
import type { ProsopoRecord } from '../../../types';

const { handoff, list, apply, reject, titles } = vi.hoisted(() => ({
  handoff: vi.fn(), list: vi.fn(), apply: vi.fn(), reject: vi.fn(), titles: vi.fn(),
}));
vi.mock('../../../services/prosopographyService', async () => {
  const actual = await vi.importActual<typeof import('../../../services/prosopographyService')>(
    '../../../services/prosopographyService');
  return {
    EnrichmentApplyError: actual.EnrichmentApplyError,
    createEnrichmentHandoff: handoff, listEnrichmentProposals: list,
    applyEnrichmentProposal: apply, rejectEnrichmentProposal: reject, getWorkTitles: titles,
  };
});
import AgentEnrichmentPanel from '../AgentEnrichmentPanel';
import { EnrichmentApplyError } from '../../../services/prosopographyService';

const person = { id: 'vutt:Pabc', updated_at: 'v1', occupations: [], education: [] } as unknown as ProsopoRecord;
const ev = (quote: string) => [{ source_kind: 'vutt_page', work_id: 'w1', page: 5, printed_page: '3', quote }];
const proposal = {
  proposal_id: 'p1', person_id: person.id, revision: 'rev1', base_updated_at: 'v0', created_at: 1, expires_at: 9999999999,
  items: [
    { kind: 'occupation', match_status: 'matched', raw_occupation: 'Notarius publicus',
      occupation_key: 'notar', registry_labels: { occupation_key: 'notar' }, registry_ids: { occupation_key: 'Q189010' },
      review_state: { state: 'applicable' }, evidence: ev('Notarius publicus Wolgastensis') },
    { kind: 'occupation', match_status: 'new_registry_candidate', raw_occupation: 'Feldprediger',
      occupation_key: 'valipreester', occupation_entry: { key: 'valipreester', labels: { et: 'välipreester', en: 'military chaplain' }, variants: ['Feldprediger'] },
      registry_labels: { occupation_key: 'välipreester' }, review_state: { state: 'applicable' }, evidence: ev('Feldprediger') },
    { kind: 'education', match_status: 'already_present', raw_institution: 'Rostock', institution_key: 'rostock',
      registry_labels: { institution_key: 'Rostocki ülikool' }, review_state: { state: 'already_present' }, evidence: ev('Rostochii') },
    { kind: 'occupation', match_status: 'matched', raw_occupation: 'Pastor', occupation_key: 'pastor',
      registry_labels: {}, review_state: { state: 'blocked', reason: 'duplicate_entry' }, evidence: ev('Pastor') },
  ],
};

const renderPanel = (onApplied = vi.fn(), isDirty = false) => render(<MemoryRouter>
  <AgentEnrichmentPanel person={person} token="tok" isDirty={isDirty} onApplied={onApplied} /></MemoryRouter>);

beforeEach(() => {
  for (const fn of [handoff, list, apply, reject, titles]) fn.mockReset();
  list.mockResolvedValue([proposal]);
  titles.mockResolvedValue({ w1: { title: 'Consuetudines', year: 1632, restricted: false } });
  apply.mockResolvedValue({ ...person, updated_at: 'v2' });
  reject.mockResolvedValue({ proposal_id: 'p1', remaining: 3 });
  handoff.mockResolvedValue({ code: 'code-1', expires_at: 9999999999 });
});

describe('agendi ettepanekute ülevaatus', () => {
  it('näitab kolme olekut, registrikirjet, tõendit ja blokeeritud rea põhjust', async () => {
    renderPanel();
    expect(await screen.findAllByText('registris')).toHaveLength(2);   // read 0 ja 3
    expect(screen.getByText('uus registrisse')).toBeTruthy();
    expect(screen.getByText('juba kaardil')).toBeTruthy();
    expect(screen.getByText('Q189010')).toBeTruthy();
    expect(screen.getByText(/military chaplain/)).toBeTruthy();
    expect(await screen.findAllByText('Consuetudines')).toHaveLength(4);
    expect(screen.getByText(/Sama fakt on kaardil juba olemas/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Lisa tõend' })).toBeTruthy();
    const confirms = screen.getAllByRole('button', { name: 'Kinnita' });
    expect(confirms).toHaveLength(3);
    expect((confirms[2] as HTMLButtonElement).disabled).toBe(true);   // blokeeritud rida
  });

  it('Kinnita kutsub apply ühe reaga ja annab kaardi tagasi', async () => {
    const onApplied = vi.fn();
    renderPanel(onApplied);
    fireEvent.click((await screen.findAllByRole('button', { name: 'Kinnita' }))[0]);
    await waitFor(() => expect(apply).toHaveBeenCalledWith(person.id, 'p1', [0], 'tok', 'rev1'));
    await waitFor(() => expect(onApplied).toHaveBeenCalledWith(expect.objectContaining({ updated_at: 'v2' })));
    await waitFor(() => expect(list).toHaveBeenCalledTimes(2));
  });

  it('Kinnita kõik saadab kõik mitte-blokeeritud read', async () => {
    renderPanel();
    fireEvent.click(await screen.findByRole('button', { name: 'Kinnita kõik (3)' }));
    await waitFor(() => expect(apply).toHaveBeenCalledWith(person.id, 'p1', [0, 1, 2], 'tok', 'rev1'));
  });

  it('kinnituse ajal on näha, et salvestus käib', async () => {
    let finish!: (v: unknown) => void;
    apply.mockReturnValue(new Promise(r => { finish = r; }));
    renderPanel();
    fireEvent.click(await screen.findByRole('button', { name: 'Kinnita kõik (3)' }));
    expect(await screen.findByText(/Salvestan 3 kirjet/)).toBeTruthy();
    finish({ ...person, updated_at: 'v2' });
    await waitFor(() => expect(screen.queryByText(/Salvestan 3 kirjet/)).toBeNull());
  });

  it('Lükka tagasi kutsub reject-i', async () => {
    renderPanel();
    fireEvent.click((await screen.findAllByRole('button', { name: 'Lükka tagasi' }))[3]);
    await waitFor(() => expect(reject).toHaveBeenCalledWith(person.id, 'p1', [3], 'tok', 'rev1'));
  });

  it('loodud registrikirjete teade', async () => {
    apply.mockRejectedValue(new EnrichmentApplyError('stale_person', ['valipreester']));
    renderPanel();
    fireEvent.click((await screen.findAllByRole('button', { name: 'Kinnita' }))[1]);
    expect(await screen.findByText(/Registrikirjed valipreester loodi, kaarti ei muudetud/)).toBeTruthy();
  });

  it('eelkontrolli viga näidatakse real ja öeldakse, et midagi ei salvestatud', async () => {
    apply.mockRejectedValue(new Error('items[1]: duplicate_entry'));
    renderPanel();
    fireEvent.click(await screen.findByRole('button', { name: 'Kinnita kõik (3)' }));
    expect(await screen.findByText(/Midagi ei salvestatud/)).toBeTruthy();
    // Rida 3 on serverist blokeeritud; rida 1 saab sama põhjuse eelkontrollist.
    await waitFor(() => expect(screen.getAllByText('Sama fakt on kaardil juba olemas.')).toHaveLength(2));
    expect(screen.queryByText(/items\[1\]/)).toBeNull();
  });

  it('salvestamata vorm lukustab otsused', async () => {
    renderPanel(vi.fn(), true);
    const confirms = await screen.findAllByRole('button', { name: 'Kinnita' });
    expect(confirms.every(button => (button as HTMLButtonElement).disabled)).toBe(true);
    expect((screen.getByRole('button', { name: 'Kinnita kõik (3)' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('kood kõigile isikutele', async () => {
    handoff.mockResolvedValue({ code: 'any-code', expires_at: 9999999999, scope: 'any', max_uses: 200 });
    renderPanel();
    fireEvent.click(await screen.findByRole('button', { name: 'Kood kõigile isikutele' }));
    await waitFor(() => expect(handoff).toHaveBeenCalledWith(null, 'tok'));
    expect(await screen.findByText('any-code')).toBeTruthy();
  });
});
