/**
 * `createPersonChecked` — isiku loomine ühe sammuga (spekk §4.2).
 * 409 `identifier_conflict`/`exists` peab muutuma `PersonConflictError`-iks,
 * mille valija saab kinni püüda ja olemasoleva kaardi valida.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { createPersonChecked, updatePerson, PersonConflictError } from '../prosopographyService';

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

describe('updatePerson', () => {
  it('409 identifier_conflict → PersonConflictError', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      detail: { error: 'identifier_conflict', conflict: 'exists', existing_person_ids: ['vutt:Paaa'] },
    }), { status: 409 })));
    const err = await updatePerson('vutt:Pbbb', { updated_at: 't' } as any, 't').catch(e => e);
    expect(err).toBeInstanceOf(PersonConflictError);
    expect(err.conflict).toBe('exists');
    expect(err.existingPersonIds).toEqual(['vutt:Paaa']);
  });

  it('tavaline 409 (versioonikonflikt) → {conflict: true} veakuju', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      detail: { current_updated_at: '2026-01-01T00:00:00+00:00' },
    }), { status: 409 })));
    const err = await updatePerson('vutt:Pbbb', { updated_at: 't' } as any, 't').catch(e => e);
    expect(err).not.toBeInstanceOf(PersonConflictError);
    expect(err.conflict).toBe(true);
    expect(err.current_updated_at).toBe('2026-01-01T00:00:00+00:00');
  });
});
