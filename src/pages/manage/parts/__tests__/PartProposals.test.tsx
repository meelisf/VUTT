/** @vitest-environment jsdom */
// Agendikood on ainult /review-l (ADR 0058, 2026-10-20); osade vahekaart viitab sinna.
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import PartProposals from '../PartProposals';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k, i18n: { language: 'et' } }),
}));
const api = vi.hoisted(() => ({
  listPartProposals: vi.fn(), decidePartProposal: vi.fn(), acceptPartProposals: vi.fn(),
}));
vi.mock('../../../../services/workPartsApi', () => api);

const props = { workId: 'w1', token: 't', refreshKey: 0, onPreview: () => {}, onEdit: () => {}, onChanged: () => {}, parts: [] };

beforeEach(() => {
  Object.values(api).forEach(f => f.mockReset());
  api.listPartProposals.mockResolvedValue([]);
});

describe('PartProposals agendikood', () => {
  it('koodinuppe ei ole, on viide /review-le', async () => {
    render(<MemoryRouter><PartProposals {...props} /></MemoryRouter>);
    await screen.findByText('manage.parts.proposals.empty');
    expect(screen.queryByText('manage.parts.proposals.createCode')).toBeNull();
    expect(screen.queryByText('manage.parts.proposals.createCodeAll')).toBeNull();
    expect(screen.getByRole('link', { name: 'manage.parts.proposals.codeOnReview' }).getAttribute('href')).toBe('/review');
  });
});
