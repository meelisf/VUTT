/** @vitest-environment jsdom */
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import WikidataPlaceSearch from '../WikidataPlaceSearch';
import { searchPlacesWikidata, fetchPlaceWikidata } from '../../services/prosopographyService';

const { t } = vi.hoisted(() => ({ t: (key: string) => key }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t }) }));
vi.mock('../../services/prosopographyService', () => ({ searchPlacesWikidata: vi.fn(), fetchPlaceWikidata: vi.fn() }));
const item = { q: 'Q3223979', label: 'Tønder', description: 'town in Denmark', aliases: ['Tondern'] };
const details = { labels: { en: 'Tønder' }, type: 'city', coordinates: { lat: 54.94, lon: 8.86 }, parents: [] };
const tick = () => act(async () => { await vi.advanceTimersByTimeAsync(500); });
beforeEach(() => { vi.useFakeTimers(); vi.mocked(searchPlacesWikidata).mockReset(); vi.mocked(fetchPlaceWikidata).mockReset(); });
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe('shared Wikidata place search', () => {
  it('debounces typing and loads coordinates only when the user selects a candidate', async () => {
    vi.mocked(searchPlacesWikidata).mockResolvedValue([item]);
    vi.mocked(fetchPlaceWikidata).mockResolvedValue(details);
    const selected = vi.fn();
    render(<WikidataPlaceSearch lang="et" onSelect={selected} />);
    const input = screen.getByRole('textbox');
    fireEvent.change(input, { target: { value: 'Tø' } });
    fireEvent.change(input, { target: { value: 'Tønder' } });
    expect(searchPlacesWikidata).not.toHaveBeenCalled();
    await tick();
    expect(searchPlacesWikidata).toHaveBeenCalledExactlyOnceWith('Tønder', 'et');
    expect(fetchPlaceWikidata).not.toHaveBeenCalled();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Tønder/ })); });
    expect(selected).toHaveBeenCalledExactlyOnceWith(item, details);
  });
  it('discards late results from an older query', async () => {
    let resolveOld!: (items: typeof item[]) => void;
    vi.mocked(searchPlacesWikidata).mockImplementationOnce(() => new Promise(resolve => { resolveOld = resolve; }));
    vi.mocked(searchPlacesWikidata).mockResolvedValueOnce([]);
    render(<WikidataPlaceSearch lang="et" onSelect={() => {}} />);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Tønder' } });
    await tick();
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Riia' } });
    await tick();
    await act(async () => { resolveOld([item]); });
    expect(screen.queryByRole('button', { name: /Tønder/ })).toBeNull();
    expect(screen.getByText('place.notFound')).toBeTruthy();
  });
  it('shows lookup failures as errors instead of claiming there are no matches', async () => {
    vi.mocked(searchPlacesWikidata).mockRejectedValue(new Error('429'));
    render(<WikidataPlaceSearch initialQuery="Tønder" lang="et" onSelect={() => {}} />);
    await tick();
    expect(screen.getByRole('alert').textContent).toContain('place.searchError');
    expect(screen.queryByText('place.notFound')).toBeNull();
  });
  it('does not apply a Q-code when detail loading fails', async () => {
    vi.mocked(searchPlacesWikidata).mockResolvedValue([item]);
    vi.mocked(fetchPlaceWikidata).mockRejectedValue(new Error('offline'));
    const selected = vi.fn();
    render(<WikidataPlaceSearch initialQuery="Q3223979" lang="et" onSelect={selected} />);
    await tick();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Tønder/ })); });
    expect(selected).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toBeTruthy();
  });
});
