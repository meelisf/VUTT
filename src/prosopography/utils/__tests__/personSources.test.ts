import { describe, expect, it } from 'vitest';
import { linkifyCitation, partLabel, splitCitationKey } from '../personSources';

describe('allikakirje kuvaabi (ADR 0078)', () => {
  it('lühivõti ainult lühikese koolonieelse osa korral', () => {
    expect(splitCitationKey('Aarma ja Bruns 2000/2020: Liivi Aarma. Artikkel.'))
      .toEqual({ key: 'Aarma ja Bruns 2000/2020', rest: 'Liivi Aarma. Artikkel.' });
    expect(splitCitationKey('https://example.org/x').key).toBeNull();
    expect(splitCitationKey('Ilma võtmeta viide').key).toBeNull();
    expect(splitCitationKey(`${'x'.repeat(41)}: liiga pikk`).key).toBeNull();
  });

  it('URL → domeen, DOI → doi.org; lauselõpp jääb lingist välja', () => {
    expect(linkifyCitation('Tuna 3. https://www.ra.ee/a.pdf. DOI 10.23797/978352.')).toEqual([
      { kind: 'text', text: 'Tuna 3. ' },
      { kind: 'link', text: 'ra.ee', href: 'https://www.ra.ee/a.pdf' },
      { kind: 'text', text: '. ' },
      { kind: 'text', text: 'DOI ' },
      { kind: 'link', text: '10.23797/978352', href: 'https://doi.org/10.23797/978352' },
      { kind: 'text', text: '.' },
    ]);
    expect(linkifyCitation('lihtne tekst')).toEqual([{ kind: 'text', text: 'lihtne tekst' }]);
  });

  it('osa pealkiri jääb ära, kui kordab teose pealkirja', () => {
    const work = 'Die offenbahrung des sterbens und lebens des Herrn Jesu Christi, als Herr Spener…';
    expect(partLabel({ kindLabel: 'Kõne', title: 'Die offenbahrung des sterbens und lebens des Herrn', firstPage: 3 }, work)).toBe('Kõne');
    expect(partLabel({ kindLabel: 'Proosatekst', title: 'Personalia', firstPage: 20 }, work)).toBe('Proosatekst · Personalia');
    expect(partLabel({ kindLabel: 'Kiri', title: null, firstPage: 223 }, work)).toBe('Kiri');
  });
});
