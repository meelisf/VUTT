/** @vitest-environment jsdom */
import { render, screen, within, waitFor, cleanup, fireEvent, configure } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';

// Mitme järjestikuse päringuga voog: vaikimisi 1 s jääb täiskomplekti koormuse all väheks.
configure({ asyncUtilTimeout: 3000 });
import type { ConvoluteBlock, Work } from '../../../types';

// i18n: võti + interpolatsioon nähtavaks, et testid näeksid arve
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (k: string, o?: any) => (o && typeof o === 'object' ? `${k}:${o.count ?? o.n ?? ''}` : (typeof o === 'string' ? o : k)),
    i18n: { language: 'et' },
  }),
}));
const getWorkExemplars = vi.fn();
vi.mock('../../../services/workApi', () => ({ getWorkExemplars: (...a: unknown[]) => getWorkExemplars(...a) }));
vi.mock('../../../contexts/UserContext', () => ({ useUser: () => ({ user: null, authToken: 'tok' }) }));

import ConvoluteBlocks from '../ConvoluteBlocks';
import SameVolumeBlock from '../SameVolumeBlock';

// Näide issue #702-st: TÜR R Est.B-954 (13 trükist) ja R Est.B-954 (I) (4 trükist)
const blocks: ConvoluteBlock[] = [
  {
    exemplar_id: 'a', key: 'tür:r est.b-954', holder: 'TÜR', reference: 'R Est.B-954', total: 13,
    contents: 'Fischer; Personalia; …',
    members: [
      { work_id: 'w1', exemplar_id: 'a', position: 0, title: 'Das Bild eines guten … Regenten', year: 1697, readable: true, current: true },
      { work_id: 'w2', exemplar_id: 'p', position: 1, title: 'Personalia … Carolus XI', year: 1697, readable: true, current: false },
    ],
  },
  {
    exemplar_id: 'b', key: 'tür:r est.b-954 (i)', holder: 'TÜR', reference: 'R Est.B-954 (I)', total: 4,
    members: [
      { work_id: 'w1', exemplar_id: 'b', position: null, title: 'Das Bild eines guten … Regenten', year: 1697, readable: true, current: true },
      { work_id: 'w3', exemplar_id: 'q', position: 3, title: 'Piiratud trükis', year: 1697, readable: false, current: false },
    ],
  },
];

afterEach(() => cleanup());

describe('ConvoluteBlocks', () => {
  it('sama trükise kaks eksemplari kahes konvoluudis → kaks plokki', () => {
    render(<MemoryRouter><ConvoluteBlocks blocks={blocks} lang="et" /></MemoryRouter>);
    const rendered = screen.getAllByTestId('convolute-block');
    expect(rendered).toHaveLength(2);
    expect(rendered[0].textContent).toContain('TÜR R Est.B-954');
    expect(rendered[1].textContent).toContain('TÜR R Est.B-954 (I)');
  });

  it('serveri järjekord, praegune teos esile tõstetud ja lingita, puuduvate arv', () => {
    render(<MemoryRouter><ConvoluteBlocks blocks={[blocks[0]]} lang="et" /></MemoryRouter>);
    const items = screen.getAllByRole('listitem');
    expect(items[0].getAttribute('aria-current')).toBe('true');
    expect(items[0].textContent).toContain('common:convolute.main');
    expect(within(items[0]).queryByRole('link')).toBeNull();
    expect(items[1].textContent).toContain('common:convolute.position:1');
    expect(within(items[1]).getByRole('link').getAttribute('href')).toBe('/work/w2/1');
    expect(screen.getByText('common:convolute.missing:11')).toBeTruthy();
    expect(screen.getByText('common:convolute.total:13', { exact: false })).toBeTruthy();
  });

  it('piiratud liige: pealkiri lingita + märge', () => {
    render(<MemoryRouter><ConvoluteBlocks blocks={[blocks[1]]} lang="et" /></MemoryRouter>);
    const restricted = screen.getAllByRole('listitem')[1];
    expect(restricted.textContent).toContain('Piiratud trükis');
    expect(within(restricted).queryByRole('link')).toBeNull();
    expect(restricted.textContent).toContain('common:workRelations.restricted');
  });

  it('teadmata arvuga plokis puuduvate rida ei ole; kärbitud sisukord laieneb', () => {
    // jsdom ei paiguta: kärbitust simuleeritakse mõõtude kaudu
    const sh = vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockReturnValue(80);
    const ch = vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(32);
    try {
      const noTotal = { ...blocks[0], total: null };
      render(<MemoryRouter><ConvoluteBlocks blocks={[noTotal]} lang="et" /></MemoryRouter>);
      expect(screen.queryByText(/common:convolute.missing/)).toBeNull();
      fireEvent.click(screen.getByText('common:convolute.showContents'));
      expect(screen.getByText('common:convolute.hideContents')).toBeTruthy();
    } finally { sh.mockRestore(); ch.mockRestore(); }
  });

  it('lühike sisukord: laiendusnuppu ei ole', () => {
    render(<MemoryRouter><ConvoluteBlocks blocks={[blocks[0]]} lang="et" /></MemoryRouter>);
    expect(screen.getByText('Fischer; Personalia; …')).toBeTruthy();
    expect(screen.queryByText('common:convolute.showContents')).toBeNull();
  });
});

describe('SameVolumeBlock', () => {
  beforeEach(() => getWorkExemplars.mockReset());

  const work = (convolute_count: number, extra: Partial<Work> = {}) =>
    ({ work_id: 'w1', convolute_count, archive_refs: [], ...extra } as unknown as Work);

  it('konvoluudita teos ei tee päringut ega näita plokki', () => {
    render(<MemoryRouter><SameVolumeBlock work={work(0)} lang="et" /></MemoryRouter>);
    expect(getWorkExemplars).not.toHaveBeenCalled();
    expect(screen.queryByTestId('same-volume-block')).toBeNull();
  });

  it('konvoluudis teos laeb plokid serverist', async () => {
    getWorkExemplars.mockResolvedValue({ exemplars: [], convolutes: blocks });
    render(<MemoryRouter><SameVolumeBlock work={work(2)} lang="et" /></MemoryRouter>);
    await waitFor(() => expect(screen.getAllByTestId('convolute-block')).toHaveLength(2));
    expect(getWorkExemplars).toHaveBeenCalledWith('w1', 'tok');
    expect(screen.getByText('common:convolute.title')).toBeTruthy();
  });

  it('eksemplaride salvestus (exemplars_rev) laeb uuesti ilma plokki peitmata; uus archive_refs ei lae', async () => {
    getWorkExemplars.mockResolvedValue({ exemplars: [], convolutes: blocks });
    const { rerender } = render(<MemoryRouter><SameVolumeBlock work={work(2)} lang="et" /></MemoryRouter>);
    await waitFor(() => expect(screen.getAllByTestId('convolute-block')).toHaveLength(2));

    // Workspace laadis teose objekti uuesti (tokeni vahetus): sama sisu, uus massiiv
    rerender(<MemoryRouter><SameVolumeBlock work={work(2, { archive_refs: [] })} lang="et" /></MemoryRouter>);
    expect(getWorkExemplars).toHaveBeenCalledTimes(1);

    let resolve!: (v: unknown) => void;
    getWorkExemplars.mockReturnValue(new Promise(r => { resolve = r; }));
    rerender(<MemoryRouter><SameVolumeBlock work={work(2, { exemplars_rev: 1 })} lang="et" /></MemoryRouter>);
    expect(getWorkExemplars).toHaveBeenCalledTimes(2);
    // Päringu ajal jääb vana plokk nähtavale
    expect(screen.getAllByTestId('convolute-block')).toHaveLength(2);
    resolve({ exemplars: [], convolutes: [blocks[0]] });
    await waitFor(() => expect(screen.getAllByTestId('convolute-block')).toHaveLength(1));
  });

  it('hiljaks jäänud vastus ei kirjuta uuemat üle', async () => {
    let first!: (v: unknown) => void;
    getWorkExemplars.mockReturnValueOnce(new Promise(r => { first = r; }));
    getWorkExemplars.mockResolvedValueOnce({ exemplars: [], convolutes: [blocks[1]] });
    const { rerender } = render(<MemoryRouter><SameVolumeBlock work={work(2)} lang="et" /></MemoryRouter>);
    rerender(<MemoryRouter><SameVolumeBlock work={work(2, { exemplars_rev: 1 })} lang="et" /></MemoryRouter>);
    await waitFor(() => expect(screen.getAllByTestId('convolute-block')).toHaveLength(1));
    first({ exemplars: [], convolutes: blocks });
    await new Promise(r => setTimeout(r, 0));
    expect(screen.getAllByTestId('convolute-block')).toHaveLength(1);
  });
});
