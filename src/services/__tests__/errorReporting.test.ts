import { describe, expect, it } from 'vitest';
import { scrubErrorEvent } from '../errorReporting';


describe('scrubErrorEvent', () => {
  it('eemaldab kasutaja, päringu sisu, query ja breadcrumb data', () => {
    const event = scrubErrorEvent({
      user: { username: 'editor' },
      request: {
        url: 'https://vutt.ut.ee/api/files/save?token=secret',
        method: 'POST',
        headers: { authorization: 'Bearer secret' },
        data: 'transkriptsioon',
      },
      breadcrumbs: [{ category: 'fetch', data: { url: '?token=secret' } }],
    } as unknown as Parameters<typeof scrubErrorEvent>[0]);

    expect(event.user).toBeUndefined();
    expect(event.request).toEqual({ url: 'https://vutt.ut.ee/api/files/save' });
    expect(event.breadcrumbs).toEqual([{ category: 'fetch' }]);
  });
});
