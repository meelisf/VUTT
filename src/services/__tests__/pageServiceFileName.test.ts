import { beforeEach, describe, expect, it, vi } from 'vitest';

const { fetchMock } = vi.hoisted(() => ({ fetchMock: vi.fn() }));
vi.mock('../../utils/fetchWithTimeout', () => ({
  fetchWithTimeout: fetchMock,
  getAuthHeaders: () => ({}),
}));
vi.mock('../../config', () => ({ FILE_API_URL: '/api/files', IMAGE_BASE_URL: '/api/images' }));
vi.mock('../meiliService', () => ({ checkMixedContent: vi.fn(), normalizePage: vi.fn((p) => p) }));

import { savePage, replyToComment } from '../pageService';
import { getFullImageUrl } from '../workImageService';
import type { Page } from '../../types';

// z0kdh0 (2026-10-15): poolitusjärgne failinimi sisaldab kausta „ä"-d → /save 404
const page = {
  work_id: 'z0kdh0', page_number: 1, status: 'Toores', text_content: 'x', comments: [],
  original_path: '1633-Liefflä',
  image_url: getFullImageUrl('1633-Liefflä/1633-Liefflä-z0kdh0-0p3ks2.jpg'),
} as unknown as Page;

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockResolvedValue({ ok: true, json: async () => ({ status: 'success', comments: [] }), text: async () => JSON.stringify({ status: 'success', comments: [] }) });
});

const sentBody = () => JSON.parse(fetchMock.mock.calls.at(-1)![1].body);

describe('lehe failinimi serveripäringutes on kettal olev kuju', () => {
  it('/save saadab ä-ga failinime, mitte %C3%A4', async () => {
    await savePage(page);
    expect(sentBody().file_name).toBe('1633-Liefflä-z0kdh0-0p3ks2.txt');
  });
  it('/page-comments/reply samuti', async () => {
    await replyToComment(page, 'c1', 'vastus');
    expect(sentBody().file_name).toBe('1633-Liefflä-z0kdh0-0p3ks2.txt');
  });
});
