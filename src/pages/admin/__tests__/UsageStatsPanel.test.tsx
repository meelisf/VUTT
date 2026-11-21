/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import UsageStatsPanel from '../UsageStatsPanel';
import { apiGet } from '../../../services/apiClient';

const { t } = vi.hoisted(() => ({ t: (key: string) => key }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t, i18n: { language: 'et' } }) }));
vi.mock('../../../services/apiClient', () => ({ apiGet: vi.fn() }));
afterEach(() => { cleanup(); vi.clearAllMocks(); });

const paev = (date: string, visitors: number) => ({
  date, requests: 100, visitors, logged_in: 2, page_loads: 10, meili_queries: 50,
  saves: 3, polling: 20, bot_requests: 5, bot_ips: 2, monitoring: 1440,
});

const data = {
  days: [paev('2026-11-19', 40), paev('2026-11-20', 30)],
  totals: { requests: 200, page_loads: 20, meili_queries: 100, saves: 6, polling: 40, bot_requests: 10, monitoring: 2880 },
  daily: { visitors: { avg: 35, max: 40 }, logged_in: { avg: 2, max: 2 }, bot_ips: { avg: 2, max: 2 } },
  tops: {
    top_works: [{ id: 'abc123', n: 4, label: 'Disputatio' }, { id: 'zzz999', n: 1, label: null }],
    top_persons: [{ id: 'vutt:Prnj8gw', n: 2, label: 'Laurentius Ludenius' }],
    referrers: [{ id: 'google.com', n: 3, label: null }],
    bots: [],
  },
  first_date: '2026-11-07',
};

describe('UsageStatsPanel (#855)', () => {
  it('näitab koondi, top-loendid lingina ja vahetab perioodi', async () => {
    vi.mocked(apiGet).mockResolvedValue(data);
    render(<MemoryRouter><UsageStatsPanel token="x" /></MemoryRouter>);
    expect(await screen.findByText('Disputatio')).toBeTruthy();
    expect(vi.mocked(apiGet).mock.calls[0][0]).toContain('/admin/usage-stats?days=30');
    expect(screen.getByText('Disputatio').closest('a')?.getAttribute('href')).toBe('/work/abc123');
    // Pealkirjata (nt loetamatu) teos näitab ID-d.
    expect(screen.getByText('zzz999')).toBeTruthy();
    expect(screen.getByText('Laurentius Ludenius').closest('a')?.getAttribute('href')).toBe('/persons/vutt:Prnj8gw');
    expect(screen.getByText('google.com').closest('a')).toBeNull();
    expect(screen.getByText('35')).toBeTruthy();

    fireEvent.click(screen.getAllByRole('button', { name: 'admin:usage.periodDays' })[0]);
    await waitFor(() => expect(vi.mocked(apiGet).mock.calls.at(-1)![0]).toContain('days=7'));
  });

  it('tühjade andmetega näitab selgitust', async () => {
    vi.mocked(apiGet).mockResolvedValue({ ...data, days: [], first_date: null });
    render(<MemoryRouter><UsageStatsPanel /></MemoryRouter>);
    expect(await screen.findByText('admin:usage.empty')).toBeTruthy();
  });
});
