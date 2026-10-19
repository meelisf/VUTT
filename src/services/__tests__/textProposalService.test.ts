import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../config', () => ({ FILE_API_URL: '/api/files' }));
const fetchMock = vi.fn();
vi.mock('../../utils/fetchWithTimeout', () => ({
  fetchWithTimeout: (...a: unknown[]) => fetchMock(...a),
  getAuthHeaders: (t?: string) => (t ? { Authorization: `Bearer ${t}` } : {}),
}));

import { acceptPack, getReviewPage, listPacks, rejectPage } from '../textProposalService';
import { savePage } from '../pageService';

const ok = (body: unknown, status = 200) => ({ ok: status < 400, status, json: async () => body });

beforeEach(() => fetchMock.mockReset());

describe('textProposalService', () => {
  it('listPacks: kõik või teose kaupa', async () => {
    fetchMock.mockResolvedValue(ok([]));
    await listPacks('t');
    await listPacks('t', 'w1');
    expect(fetchMock.mock.calls[0][0]).toBe('/api/files/text-proposals');
    expect(fetchMock.mock.calls[1][0]).toBe('/api/files/works/w1/text-proposals');
  });

  it('getReviewPage kodeerib tee', async () => {
    fetchMock.mockResolvedValue(ok({ state: 'pending' }));
    await getReviewPage('t', 'w1', 'p/1', 't-001');
    expect(fetchMock.mock.calls[0][0]).toBe('/api/files/works/w1/text-proposals/p%2F1/pages/t-001');
  });

  it('acceptPack 409 → job_running', async () => {
    fetchMock.mockResolvedValue(ok({ detail: 'job_running' }, 409));
    await expect(acceptPack('t', 'w1', 'p1')).rejects.toThrow('job_running');
  });

  it('viga kannab serveri detail-koodi', async () => {
    fetchMock.mockResolvedValue(ok({ detail: 'unknown_proposal' }, 404));
    await expect(rejectPage('t', 'w1', 'p1', 't-001')).rejects.toThrow('unknown_proposal');
  });


  it('savePage saadab proposal-viite', async () => {
    fetchMock.mockResolvedValue(ok({ status: 'success' }));
    const page = { original_path: 'slug-w1', image_url: '/api/images/slug-w1/t-001.jpg', text_content: 'x',
      status: 'Toores', comments: [], page_tags: [], text_annotations: [], work_id: 'w1' } as never;
    await savePage(page, 'a', 'u', 't', undefined, { id: 'p1', stem: 't-001' });
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.proposal).toEqual({ id: 'p1', stem: 't-001' });
  });
});
