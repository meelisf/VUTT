/** @vitest-environment jsdom */
// Teose halduse vahekaart „Eksemplarid" (#703): agendi ettepanekute kinnitus/tagasilükkamine.
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within, configure } from '@testing-library/react';
import type { ExemplarProposal } from '../../../../services/exemplarProposalsApi';

configure({ asyncUtilTimeout: 3000 });

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string, o?: unknown) => (typeof o === 'string' ? o : k), i18n: { language: 'et' } }),
}));
const notify = vi.fn();
vi.mock('../../../../contexts/FeedbackContext', () => ({ useNotify: () => notify }));
const api = vi.hoisted(() => ({ listExemplarProposals: vi.fn(), decideExemplarProposals: vi.fn() }));
vi.mock('../../../../services/exemplarProposalsApi', async (orig) => ({
  ...(await orig<typeof import('../../../../services/exemplarProposalsApi')>()),
  listExemplarProposals: api.listExemplarProposals,
  decideExemplarProposals: api.decideExemplarProposals,
}));

import ExemplarProposalsTab from '../ExemplarProposalsTab';

const SRC = { kind: 'ester' as const, ref: 'b2648642', quote: 'R Est.B-954 (I): defektne' };
const proposal = (states: string[] = ['pending', 'pending']): ExemplarProposal => ({
  proposal_id: 'p1', created_at: 1_700_000_000, expires_at: 1_800_000_000, note: 'ESTER b2648642',
  rows: [
    { index: 0, op: 'update', exemplar_id: 'a', status: 'pending', review_state: states[0] as never,
      fields: { convolute: { reference: 'R Est.B-954', position: 0, total: 2 } }, base: {},
      source: { ...SRC, quote: 'konvoluut, koos 1 trükisega' },
      current: { id: 'a', holder: 'TÜR', shelfmark: 'R Est.B-954' } },
    { index: 1, op: 'create', status: 'pending', review_state: states[1] as never,
      fields: { holder: 'TÜR', shelfmark: 'R Est.B-954 (I)', condition: 'defektne' },
      source: SRC, current: null },
  ],
});

beforeEach(() => {
  notify.mockReset();
  api.listExemplarProposals.mockReset();
  api.decideExemplarProposals.mockReset();
  api.decideExemplarProposals.mockResolvedValue({ accepted: ['a'], rejected: 0 });
});
afterEach(() => cleanup());

const rowOf = (text: string) => screen.getByText(text).closest('tr') as HTMLElement;

describe('ExemplarProposalsTab', () => {
  it('näitab uut ja muudatusrida, allika lingi ja tsitaadi', async () => {
    api.listExemplarProposals.mockResolvedValue([proposal()]);
    render(<ExemplarProposalsTab workId="w1" token="tok" />);
    expect(await screen.findByText('R Est.B-954 (I): defektne')).toBeTruthy();
    // Märkus + kaks allikalinki
    expect(screen.getAllByText('ESTER b2648642')).toHaveLength(3);
    const links = screen.getAllByRole('link');
    expect(links[0].getAttribute('href')).toBe('https://www.ester.ee/record=b2648642*est');
    const upd = rowOf('konvoluut, koos 1 trükisega');
    expect(upd.textContent).toContain('TÜR R Est.B-954');            // millise eksemplari muudatus
    expect(upd.textContent).toContain('manage.exemplarProposals.opUpdate');
    const create = rowOf('R Est.B-954 (I): defektne');
    expect(create.textContent).toContain('manage.exemplarProposals.opCreate');
    expect(create.textContent).toContain('defektne');
  });

  it('aegunud ja topelt read ei ole valitavad', async () => {
    api.listExemplarProposals.mockResolvedValue([proposal(['stale', 'duplicate'])]);
    render(<ExemplarProposalsTab workId="w1" token="tok" />);
    await screen.findByText('R Est.B-954 (I): defektne');
    expect(screen.queryAllByRole('checkbox')).toHaveLength(0);
    expect(screen.queryByText('manage.exemplarProposals.accept')).toBeNull();
    expect(screen.getByText('manage.exemplarProposals.state.stale')).toBeTruthy();
    expect(screen.getByText('manage.exemplarProposals.state.duplicate')).toBeTruthy();
  });

  it('kinnitamatu rea saab tagasi lükata', async () => {
    api.listExemplarProposals.mockResolvedValue([proposal(['stale', 'duplicate'])]);
    render(<ExemplarProposalsTab workId="w1" token="tok" />);
    await screen.findByText('R Est.B-954 (I): defektne');
    expect(screen.getAllByText('manage.exemplarProposals.reject')).toHaveLength(2);
    fireEvent.click(within(rowOf('R Est.B-954 (I): defektne')).getByText('manage.exemplarProposals.reject'));
    await waitFor(() => expect(api.decideExemplarProposals).toHaveBeenCalledWith(
      'w1', [{ proposal_id: 'p1', index: 1 }], 'reject', 'tok'));
  });

  it('otsustatud real nuppe ei ole', async () => {
    const p = proposal(['accepted', 'rejected']);
    p.rows.forEach((r, i) => { r.status = i === 0 ? 'accepted' : 'rejected'; });
    api.listExemplarProposals.mockResolvedValue([p]);
    render(<ExemplarProposalsTab workId="w1" token="tok" />);
    await screen.findByText('R Est.B-954 (I): defektne');
    expect(screen.queryByText('manage.exemplarProposals.reject')).toBeNull();
  });

  it('kinnita valitud saadab valitud read ühe päringuga ja laeb uuesti', async () => {
    const onChanged = vi.fn();
    api.listExemplarProposals.mockResolvedValue([proposal()]);
    render(<ExemplarProposalsTab workId="w1" token="tok" onChanged={onChanged} />);
    await screen.findByText('R Est.B-954 (I): defektne');
    for (const box of screen.getAllByRole('checkbox')) fireEvent.click(box);
    fireEvent.click(screen.getByText(/manage\.exemplarProposals\.acceptSelected \(2\)/));
    await waitFor(() => expect(api.decideExemplarProposals).toHaveBeenCalledTimes(1));
    expect(api.decideExemplarProposals).toHaveBeenCalledWith(
      'w1', [{ proposal_id: 'p1', index: 0 }, { proposal_id: 'p1', index: 1 }], 'accept', 'tok');
    await waitFor(() => expect(api.listExemplarProposals).toHaveBeenCalledTimes(2));
    expect(onChanged).toHaveBeenCalled();
  });

  it('tagasilükkamine ühe rea kaupa', async () => {
    api.listExemplarProposals.mockResolvedValue([proposal()]);
    render(<ExemplarProposalsTab workId="w1" token="tok" />);
    await screen.findByText('konvoluut, koos 1 trükisega');
    fireEvent.click(within(rowOf('konvoluut, koos 1 trükisega')).getByText('manage.exemplarProposals.reject'));
    await waitFor(() => expect(api.decideExemplarProposals).toHaveBeenCalledWith(
      'w1', [{ proposal_id: 'p1', index: 0 }], 'reject', 'tok'));
  });

  it('serveri viga jõuab teatesse', async () => {
    api.listExemplarProposals.mockResolvedValue([proposal()]);
    api.decideExemplarProposals.mockRejectedValue(new Error('stale: p1/0'));
    render(<ExemplarProposalsTab workId="w1" token="tok" />);
    await screen.findByText('konvoluut, koos 1 trükisega');
    fireEvent.click(within(rowOf('konvoluut, koos 1 trükisega')).getByText('manage.exemplarProposals.accept'));
    await waitFor(() => expect(notify).toHaveBeenCalledWith(expect.any(String), 'error'));
  });
});
