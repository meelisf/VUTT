import { beforeEach, describe, expect, it, vi } from 'vitest';

// ADR 0089 p 6: transkriptsiooni aluse vahetuse API.
const { fetchMock } = vi.hoisted(() => ({ fetchMock: vi.fn() }));
vi.mock('../../utils/fetchWithTimeout', () => ({
  fetchWithTimeout: fetchMock,
  getAuthHeaders: (t?: string | null) => (t ? { Authorization: `Bearer ${t}` } : {}),
}));
vi.mock('../../config', () => ({ FILE_API_URL: '/api/files', IMAGE_BASE_URL: '/api/images' }));

import { confirmPromote, fetchPromotePreview, finishReplace, startPromote } from '../promoteApi';

const ok = (body: unknown) => fetchMock.mockResolvedValue({
  ok: true, status: 200, headers: new Headers(), json: async () => body, text: async () => JSON.stringify(body),
});
const call = () => fetchMock.mock.calls.at(-1)!;

beforeEach(() => fetchMock.mockReset());

describe('promoteApi', () => {
  it('eelvaade: GET õigele teele', async () => {
    ok({ pages: [] });
    await fetchPromotePreview('w1', 'e1', 't');
    expect(String(call()[0])).toContain('/admin/work/w1/exemplars/e1/promote/preview');
  });
  it('algus: saadab sihi ja kinnituse, tagastab upload_id', async () => {
    ok({ upload_id: 'u9' });
    const id = await startPromote('w1', 'e1', { unknown_target: 'x', confirmed_edited: { s: 'h' } }, 't');
    expect(id).toBe('u9');
    expect(JSON.parse(call()[1].body)).toEqual({ unknown_target: 'x', confirmed_edited: { s: 'h' } });
  });
  it('kinnitus: POST üleslaadimise teele', async () => {
    ok({ status: 'ok' });
    await confirmPromote('u9', { unknown_target: null, confirmed_edited: {} }, 't');
    expect(String(call()[0])).toContain('/admin/upload/u9/promote/confirm');
  });
  it('lõpetamine: teose järgi koos upload_id-ga, tagastab tulemuse', async () => {
    ok({ result: 'restored' });
    expect(await finishReplace('w1', 'u9', 't')).toBe('restored');
    expect(String(call()[0])).toContain('/admin/work/w1/replace/finish');
    expect(JSON.parse(call()[1].body)).toEqual({ upload_id: 'u9' });
  });
});
