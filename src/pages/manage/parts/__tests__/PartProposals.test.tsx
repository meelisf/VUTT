/** @vitest-environment jsdom */
// #641 järg: ÜKS agendikood teose halduses — osad + lehe tekst, ulatus see teos / kõik teosed.
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import PartProposals from '../PartProposals';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k, i18n: { language: 'et' } }),
}));
const api = vi.hoisted(() => ({
  listPartProposals: vi.fn(), createPartsHandoff: vi.fn(), decidePartProposal: vi.fn(), acceptPartProposals: vi.fn(),
}));
vi.mock('../../../../services/workPartsApi', () => api);

const props = { workId: 'w1', token: 't', refreshKey: 0, onPreview: () => {}, onEdit: () => {}, onChanged: () => {}, parts: [] };

beforeEach(() => {
  Object.values(api).forEach(f => f.mockReset());
  api.listPartProposals.mockResolvedValue([]);
  api.createPartsHandoff.mockResolvedValue({ code: 'KOOD', expires_at: 1, max_uses: 20, work_id: null, scope: 'all', pages_version: 'v' });
});

describe('PartProposals agendikood', () => {
  it('see teos', async () => {
    render(<PartProposals {...props} />);
    fireEvent.click(screen.getByText('manage.parts.proposals.createCode'));
    await waitFor(() => expect(api.createPartsHandoff).toHaveBeenCalledWith('w1', 't', 'work'));
  });

  it('kõik teosed', async () => {
    render(<PartProposals {...props} />);
    fireEvent.click(screen.getByText('manage.parts.proposals.createCodeAll'));
    await waitFor(() => expect(api.createPartsHandoff).toHaveBeenCalledWith('w1', 't', 'all'));
    expect(await screen.findByText('KOOD')).toBeTruthy();
    expect(screen.getByText('manage.parts.proposals.codeHelpAll')).toBeTruthy();
  });
});
