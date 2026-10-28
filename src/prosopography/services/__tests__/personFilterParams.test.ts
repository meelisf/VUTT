import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { appendPersonFilterParams, PERSON_FILTER_KEYS } from '../personFilterParams';

describe('appendPersonFilterParams', () => {
  it('kirjutab kõik antud filtrid, tühjad jätab välja', () => {
    const params = new URLSearchParams();
    appendPersonFilterParams(params, {
      q: 'Luden', origin_place: 'Tartu', gender: '', year_from: 1650, tag: ['Q1', 'Q2'],
    });
    expect(params.get('q')).toBe('Luden');
    expect(params.get('origin_place')).toBe('Tartu');
    expect(params.has('gender')).toBe(false);
    expect(params.get('year_from')).toBe('1650');
    expect(params.getAll('tag')).toEqual(['Q1', 'Q2']);
  });

  it('kattub serveri PersonFilters väljadega (#670)', () => {
    // Serveri dataclass on filtrite ainus loend; `tags` käib URL-is nimega `tag`.
    const src = readFileSync(resolve(__dirname, '../../../../server/prosopography/person_search.py'), 'utf8');
    const body = src.split('class PersonFilters:')[1].split('@classmethod')[0];
    const serverFields = [...body.matchAll(/^ {4}(\w+): /gm)].map(m => (m[1] === 'tags' ? 'tag' : m[1]));
    expect([...PERSON_FILTER_KEYS].sort()).toEqual(serverFields.sort());
  });
});
