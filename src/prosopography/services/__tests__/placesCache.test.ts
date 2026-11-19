/**
 * Koharegistri vahemälu (N19-11): isikuvormil küsis registrit leht ja iga PlacePicker
 * eraldi. Paralleelsed ja TTL-i sees tulevad kutsed jagavad ühte päringut; oma kirjutus
 * ja viga tühjendavad vahemälu.
 */
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { addPlace, fetchPlaces, invalidatePlacesCache } from '../prosopographyService';

const placesResponse = () => new Response(JSON.stringify({ Dorpat: { labels: { et: 'Tartu' } } }), { status: 200 });

beforeEach(() => invalidatePlacesCache());
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

const placesCalls = (f: ReturnType<typeof vi.fn>) =>
  f.mock.calls.filter(([url]) => String(url).endsWith('/places')).length;

describe('fetchPlaces vahemälu', () => {
  it('paralleelsed kutsed teevad ühe päringu', async () => {
    const f = vi.fn(async () => placesResponse());
    vi.stubGlobal('fetch', f);
    const [a, b] = await Promise.all([fetchPlaces(), fetchPlaces()]);
    expect(placesCalls(f)).toBe(1);
    expect(a).toEqual(b);
    expect(a.Dorpat).toBeDefined();
  });

  it('TTL möödudes küsitakse uuesti', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const f = vi.fn(async () => placesResponse());
    vi.stubGlobal('fetch', f);
    await fetchPlaces();
    await fetchPlaces();
    expect(placesCalls(f)).toBe(1);
    vi.setSystemTime(Date.now() + 61_000);
    await fetchPlaces();
    expect(placesCalls(f)).toBe(2);
  });

  it('viga ei jää vahemällu', async () => {
    const f = vi.fn()
      .mockResolvedValueOnce(new Response('{}', { status: 500 }))
      .mockResolvedValue(placesResponse());
    vi.stubGlobal('fetch', f);
    await expect(fetchPlaces()).rejects.toBeTruthy();
    await expect(fetchPlaces()).resolves.toHaveProperty('Dorpat');
    expect(placesCalls(f)).toBe(2);
  });

  it('koha lisamine tühjendab vahemälu', async () => {
    const f = vi.fn(async (url: string) => String(url).endsWith('/places')
      ? placesResponse()
      : new Response(JSON.stringify({ key: 'Riga', entry: {} }), { status: 200 }));
    vi.stubGlobal('fetch', f);
    await fetchPlaces();
    await addPlace('Riga', { labels: { et: 'Riia' } } as any, 't');
    await fetchPlaces();
    expect(placesCalls(f)).toBe(2);
  });
});
