/** @vitest-environment jsdom */
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Work, ResolvedRelation } from '../../../types';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string, d?: any) => (typeof d === 'string' ? d : k), i18n: { language: 'et' } }),
}));
const fetchRelations = vi.fn();
const changeRelations = vi.fn();
vi.mock('../../../services/relationsService', async (orig) => ({
  ...(await orig<typeof import('../../../services/relationsService')>()),
  fetchRelations: (...a: unknown[]) => fetchRelations(...a),
  changeRelations: (...a: unknown[]) => changeRelations(...a),
}));
let mockRole: string | null = 'admin';
vi.mock('../../../contexts/UserContext', () => ({
  useUser: () => ({ user: mockRole ? { role: mockRole, username: 'u' } : null, authToken: mockRole ? 'tok' : null }),
}));
const notify = vi.fn();
vi.mock('../../../contexts/FeedbackContext', () => ({
  useNotify: () => notify,
  useConfirm: () => async () => true,
}));
// Stabiilne viide nagu päris kontekstis — uus objekt igal renderdusel käivitaks effecti lõputult.
const meiliIndex = {};
vi.mock('../../../contexts/MeilisearchContext', () => ({ useMeiliIndex: () => meiliIndex }));
const searchWorks = vi.fn();
vi.mock('../../../services/searchService', () => ({ searchWorks: (...a: unknown[]) => searchWorks(...a) }));

import RelatedWorksBlock from '../RelatedWorksBlock';

const work = (id: string, rels: Work['relations'] = []): Work =>
  ({ work_id: id, id, title: `T ${id}`, relations: rels } as unknown as Work);
const rel = (id: string, extra: Partial<ResolvedRelation> = {}): ResolvedRelation =>
  ({ id, rel_type: 'isVersionOf', title: `Teos ${id}`, year: 1702, archive_ref: `LAB ${id}`, readable: true, ...extra });
const V = (id: string) => ({ id, rel_type: 'isVersionOf' as const });

const renderBlock = (w: Work) =>
  render(<MemoryRouter><RelatedWorksBlock work={w} lang="et" /></MemoryRouter>);

describe('RelatedWorksBlock', () => {
  beforeEach(() => {
    mockRole = 'admin';
    fetchRelations.mockReset(); changeRelations.mockReset(); notify.mockReset(); searchWorks.mockReset();
  });

  it('piiratud siht on lingita koos märkega, loetav on link', async () => {
    fetchRelations.mockResolvedValue([rel('w2'), rel('w3', { readable: false, title: 'Piiratud' })]);
    renderBlock(work('w1', [V('w2'), V('w3')]));
    const link = await screen.findByRole('link', { name: /Teos w2/ });
    expect(link.getAttribute('href')).toBe('/work/w2/1');
    expect(screen.getByText(/Piiratud/).closest('a')).toBeNull();
    expect(screen.getByText('piiratud ligipääs')).toBeTruthy();
  });

  it('ilma isVersionOf seoseta teos ei tee fetchRelations päringut', () => {
    renderBlock(work('w1', [{ id: 'x', rel_type: 'isPartOf' }]));
    expect(fetchRelations).not.toHaveBeenCalled();
    expect(screen.getByText('+ Lisa variant')).toBeTruthy();
  });

  it('mitte-admin ilma seosteta ei näe plokki', () => {
    mockRole = 'editor';
    const { container } = renderBlock(work('w1'));
    expect(container.textContent).toBe('');
  });

  it('teose vahetus ei näita eelmise teose seoseid ega hilinenud vastust', async () => {
    let resolveOld: (v: ResolvedRelation[]) => void = () => {};
    fetchRelations.mockImplementationOnce(() => new Promise(r => { resolveOld = r; }));
    fetchRelations.mockResolvedValueOnce([rel('w8')]);
    const { rerender } = renderBlock(work('w1', [V('w2')]));
    rerender(<MemoryRouter><RelatedWorksBlock work={work('w9', [V('w8')])} lang="et" /></MemoryRouter>);
    await screen.findByText(/Teos w8/);
    await act(async () => { resolveOld([rel('w2')]); });
    expect(screen.queryByText(/Teos w2/)).toBeNull();
    expect(screen.getByText(/Teos w8/)).toBeTruthy();
  });

  it('PUT viga → notify viga, plokk endises seisus', async () => {
    fetchRelations.mockResolvedValue([rel('w2')]);
    changeRelations.mockRejectedValue(new Error('500'));
    renderBlock(work('w1', [V('w2')]));
    await screen.findByText(/Teos w2/);
    fireEvent.click(screen.getByLabelText('Eemalda seos'));
    await waitFor(() => expect(notify).toHaveBeenCalledWith('Seost ei salvestatud', 'error'));
    expect(screen.getByText(/Teos w2/)).toBeTruthy();
  });

  it('valija otsingupäringus ei ole aktiivse kogu filtrit ja jätab välja praeguse ja seotud teosed', async () => {
    fetchRelations.mockResolvedValue([rel('w2')]);
    searchWorks.mockResolvedValue({ works: [work('w1'), work('w2'), work('w5')], facets: {}, totalHits: 3 });
    renderBlock(work('w1', [V('w2')]));
    await screen.findByText(/Teos w2/);
    fireEvent.click(screen.getByText('+ Lisa variant'));
    fireEvent.change(screen.getByPlaceholderText('Pealkiri, aasta või work_id'), { target: { value: 'Series' } });
    await screen.findByText('T w5');
    const options = searchWorks.mock.calls.at(-1)![2];
    expect(options).not.toHaveProperty('collection');
    expect(screen.queryByText('T w1')).toBeNull();
    expect(screen.queryByRole('button', { name: /T w2/ })).toBeNull();
  });

  it('valikust tuleb PUT ja uus loend', async () => {
    fetchRelations.mockResolvedValue([]);
    searchWorks.mockResolvedValue({ works: [work('w5')], facets: {}, totalHits: 1 });
    changeRelations.mockResolvedValue([rel('w5')]);
    renderBlock(work('w1', []));
    fireEvent.click(screen.getByText('+ Lisa variant'));
    fireEvent.change(screen.getByPlaceholderText('Pealkiri, aasta või work_id'), { target: { value: 'x' } });
    fireEvent.click(await screen.findByText('T w5'));
    await screen.findByText(/Teos w5/);
    expect(changeRelations).toHaveBeenCalledWith('w1', { add: [V('w5')], remove: [] }, 'tok');
  });
});
