/**
 * `createPersonChecked` — isiku loomine ühe sammuga (spekk §4.2).
 * 409 `identifier_conflict`/`exists` peab muutuma `PersonConflictError`-iks,
 * mille valija saab kinni püüda ja olemasoleva kaardi valida.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { createPersonChecked, PersonConflictError } from '../prosopographyService';

afterEach(() => vi.unstubAllGlobals());

describe('createPersonChecked', () => {
  it('409 exists → PersonConflictError koos olemasoleva id-ga', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      detail: { error: 'identifier_conflict', conflict: 'exists',
                existing_person_ids: ['vutt:Paaa'], existing_person_id: 'vutt:Paaa' },
    }), { status: 409 })));
    const err = await createPersonChecked({ name: 'X', created_via: 'picker' }, 't').catch(e => e);
    expect(err).toBeInstanceOf(PersonConflictError);
    expect(err.conflict).toBe('exists');
    expect(err.existingPersonIds).toEqual(['vutt:Paaa']);
  });

  it('saadab keha muutmata', async () => {
    const f = vi.fn(async () => new Response(JSON.stringify({ id: 'vutt:Pnew' }), { status: 200 }));
    vi.stubGlobal('fetch', f);
    await createPersonChecked({ card: { name: { label: 'X' } } as any, created_via: 'form' }, 't');
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toMatch(/\/prosopography\/persons\/create$/);
    expect(JSON.parse(init.body as string)).toEqual({ card: { name: { label: 'X' } }, created_via: 'form' });
  });
});
