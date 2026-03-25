import { describe, it, expect } from 'vitest';
import { buildReplaceUploadPayload, sanitizeSlugForReplace } from '../buildReplaceUploadPayload';

describe('buildReplaceUploadPayload', () => {
  const WORK_ID = 'abc123';

  it('sisaldab alati replace_work_id välja', () => {
    const payload = buildReplaceUploadPayload({ title: 'Test' }, WORK_ID);
    expect(payload.replace_work_id).toBe(WORK_ID);
  });

  it('kopeerib kõik metaandme-väljad — creators, genre, type, tags, location, publisher, languages', () => {
    const meta = {
      title: 'Disputatio',
      year: 1648,
      slug: 'disputatio-1648',
      collections: ['academia-gustaviana'],
      creators: [{ label: 'Arvidi, Andreas', id: 'vutt:P001' }],
      genre: { label: 'Väitlus', id: 'Q861911' },
      type: { label: 'Monograafia', id: 'Q571' },
      tags: [{ label: 'Teoloogia', id: 'Q5' }],
      location: { label: 'Tartu', id: 'Q3258' },
      publisher: { label: 'Vogelius, Johann', id: 'vutt:P002' },
      languages: ['la'],
    };

    const payload = buildReplaceUploadPayload(meta, WORK_ID);

    expect(payload.creators).toEqual(meta.creators);
    expect(payload.genre).toEqual(meta.genre);
    expect(payload.type).toEqual(meta.type);
    expect(payload.tags).toEqual(meta.tags);
    expect(payload.location).toEqual(meta.location);
    expect(payload.publisher).toEqual(meta.publisher);
    expect(payload.languages).toEqual(meta.languages);
    expect(payload.collections).toEqual(['academia-gustaviana']);
    expect(payload.year).toBe('1648');
  });

  it('puuduvad valikulised väljad saavad tühja vaikeväärtuse, mitte undefined', () => {
    const payload = buildReplaceUploadPayload({ title: 'Teos' }, WORK_ID);

    expect(payload.creators).toEqual([]);
    expect(payload.genre).toBeNull();
    expect(payload.type).toBeNull();
    expect(payload.tags).toEqual([]);
    expect(payload.location).toBeNull();
    expect(payload.publisher).toBeNull();
    expect(payload.languages).toEqual([]);
    expect(payload.collections).toEqual([]);
  });

  it('slug tuleneb meta.slug-ist kui olemas', () => {
    const payload = buildReplaceUploadPayload(
      { title: 'Test', year: 1650, slug: 'minu-slug' },
      WORK_ID
    );
    expect(payload.slug).toBe('minu-slug');
  });

  it('slug genereeritakse aastast + pealkirjast kui meta.slug puudub', () => {
    const payload = buildReplaceUploadPayload(
      { title: 'Disputatio ethica', year: 1648 },
      WORK_ID
    );
    expect(payload.slug).toBe('1648-disputatio-ethica');
  });

  it('collections võtab ainult esimese kollektsiooni', () => {
    const payload = buildReplaceUploadPayload(
      { title: 'Test', collections: ['coll-a', 'coll-b'] },
      WORK_ID
    );
    expect(payload.collections).toEqual(['coll-a']);
  });
});

describe('sanitizeSlugForReplace', () => {
  it('eemaldab diakriitilised märgid', () => {
    expect(sanitizeSlugForReplace('Võõrkeelne')).toBe('voorkeelne');
  });

  it('asendab tühikud ja erimärgid sidekriipsuga', () => {
    expect(sanitizeSlugForReplace('Hello World!')).toBe('hello-world');
  });

  it('tühi sisend → teos', () => {
    expect(sanitizeSlugForReplace('')).toBe('teos');
  });
});
