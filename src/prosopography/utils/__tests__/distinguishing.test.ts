import { describe, expect, it } from 'vitest';
import { yearsText, distinguishingText, plainPersonLabel, distinguishingFromPerson, sameNamePersons } from '../distinguishing';
import type { ProsopoRecord } from '../../types';

// ADR 0082: eristav rida = käsitsi täiend + kuupäevad. Ametit EI tuletata.
describe('yearsText', () => {
  it('sünni- ja surma-aasta', () => {
    expect(yearsText({ birth_year: 1608, death_year: 1660 })).toBe('1608–1660');
  });
  it('ainult sünd või ainult surm', () => {
    expect(yearsText({ birth_year: 1608 })).toBe('*1608');
    expect(yearsText({ death_year: 1660 })).toBe('†1660');
  });
  it('eluaastate puudumisel floruit', () => {
    expect(yearsText({ floruit_year_from: 1626, floruit_year_to: 1645 })).toBe('fl. 1626–1645');
    expect(yearsText({ floruit_year_from: 1626 })).toBe('fl. 1626');
  });
  it('eluaasta on olemas → floruiti ei näidata', () => {
    expect(yearsText({ birth_year: 1608, floruit_year_from: 1626, floruit_year_to: 1645 })).toBe('*1608');
  });
  it('kõik puudu → tühi', () => {
    expect(yearsText({})).toBe('');
  });
});

describe('distinguishingText', () => {
  it('täiend ja aastad koos', () => {
    expect(distinguishingText({ qualifier: 'ülikooli professor', birth_year: 1608, death_year: 1660 }))
      .toBe('ülikooli professor, 1608–1660');
  });
  it('ainult täiend või ainult aastad', () => {
    expect(distinguishingText({ qualifier: 'noorem' })).toBe('noorem');
    expect(distinguishingText({ birth_year: 1608, death_year: 1660 })).toBe('1608–1660');
  });
  it('tühikud täiendi ümber ei loe', () => {
    expect(distinguishingText({ qualifier: '   ' })).toBe('');
  });
});

describe('plainPersonLabel', () => {
  it('tavateksti kuju sulgudega', () => {
    expect(plainPersonLabel('Johannes Holm', { qualifier: 'pastor', birth_year: 1608, death_year: 1660 }))
      .toBe('Johannes Holm (pastor, 1608–1660)');
  });
  it('eristavata jääb nimi muutmata', () => {
    expect(plainPersonLabel('Johannes Holm', {})).toBe('Johannes Holm');
  });
});

describe('distinguishingFromPerson', () => {
  it('loeb kaardilt täiendi, aastad ja floruiti', () => {
    const p = {
      name: { qualifier: 'noorem' },
      birth: { date: '1608-03-01' },
      death: { date: '0000' },
      floruit: { year_from: 1626, year_to: 1645 },
    } as unknown as ProsopoRecord;
    expect(distinguishingFromPerson(p)).toEqual({
      qualifier: 'noorem', birth_year: 1608, death_year: null,
      floruit_year_from: 1626, floruit_year_to: 1645,
    });
  });
  it('sõnaline kuupäev ilma aastata ei anna aastat', () => {
    const p = { name: {}, birth: { date: 'um 1677' }, death: null } as unknown as ProsopoRecord;
    expect(distinguishingFromPerson(p).birth_year).toBeNull();
  });
});

describe('sameNamePersons', () => {
  const e = (id: string, label: string, record_status = 'draft') =>
    ({ id, label, record_status } as unknown as import('../../types').ProsopoIndexEntry);

  it('leiab sama nimekuju tõstutundetult ja tühikuid normaliseerides', () => {
    const r = sameNamePersons('Johannes  Holm', [e('a', 'johannes holm'), e('b', 'Johannes Holmius'), e('c', 'JOHANNES HOLM ')], null);
    expect(r.map(x => x.id)).toEqual(['a', 'c']);
  });
  it('jätab isiku enda ja hauakivid välja', () => {
    const r = sameNamePersons('Johannes Holm', [e('a', 'Johannes Holm'), e('self', 'Johannes Holm'), e('t', 'Johannes Holm', 'tombstone')], 'self');
    expect(r.map(x => x.id)).toEqual(['a']);
  });
  it('tühi nimi ei leia midagi', () => {
    expect(sameNamePersons('  ', [e('a', '')], null)).toEqual([]);
  });
});
