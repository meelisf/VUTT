/** @vitest-environment jsdom */
import { render, screen, fireEvent, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Work } from '../../types';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string, d?: any) => (typeof d === 'string' ? d : k), i18n: { language: 'et' } }),
}));
vi.mock('../../contexts/CollectionContext', () => ({
  useCollection: () => ({ collections: {}, getCollectionName: (id: string) => id }),
}));
vi.mock('../../hooks/useWorkThumbnail', () => ({
  useWorkThumbnail: () => ({ thumbnailSrc: '', handleThumbnailError: () => {} }),
}));
vi.mock('../../contexts/UserContext', () => ({ useUser: () => ({ user: null, authToken: null }) }));
vi.mock('../../services/relationsService', async (orig) => ({
  ...(await orig<typeof import('../../services/relationsService')>()),
  fetchRelations: vi.fn(async () => [{ id: 'w2', rel_type: 'isVersionOf', title: 'Teos w2', readable: true }]),
}));

import WorkCard from '../WorkCard';

const work = {
  work_id: 'w1', id: 'w1', title: 'Series lectionum', year: 1702, page_count: 2,
  relations: [{ id: 'w2', rel_type: 'isVersionOf' }],
} as unknown as Work;

const flush = async (ms: number) => { await act(async () => { vi.advanceTimersByTime(ms); }); };

describe('WorkCard — seoste nupp', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('seoste ülekatte avamine peidab info-nupu; info avamine sulgeb seoste ülekatte', async () => {
    render(<MemoryRouter><WorkCard work={work} /></MemoryRouter>);
    const infoButton = screen.getByLabelText('Näita metaandmeid');
    fireEvent.click(screen.getByRole('button', { name: /Seotud teosed/ }));
    await flush(0);
    expect(screen.getByTestId('relations-overlay')).toBeTruthy();
    expect(infoButton.className).toContain('hidden');

    fireEvent.keyDown(document, { key: 'Escape' });
    await flush(0);
    fireEvent.mouseEnter(infoButton);
    await flush(250);
    expect(screen.queryByTestId('relations-overlay')).toBeNull();
    expect(screen.getByRole('button', { name: /Seotud teosed/ }).className).toContain('hidden');
  });

  it('ilma seosteta teosel nuppu ei ole', () => {
    render(<MemoryRouter><WorkCard work={{ ...work, relations: [] } as Work} /></MemoryRouter>);
    expect(screen.queryByRole('button', { name: /Seotud teosed/ })).toBeNull();
  });
});
