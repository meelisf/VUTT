import { describe, it, expect } from 'vitest';
import { ALL_COLLECTIONS } from '../collectionUrl';
import { decideCollectionSync } from '../collectionSync';
import { Collections } from '../../services/collectionService';

const COLLECTIONS = {
  'universitas-dorpatensis-1': { name: { et: 'Rootsi aja ülikool', en: 'Swedish era' } },
  'academia-gustaviana': { name: { et: 'Academia Gustaviana', en: 'Academia Gustaviana' } },
  klingeriana: { name: { et: 'Klingeriana', en: 'Klingeriana' } },
} as unknown as Collections;

const P = 'universitas-dorpatensis-1';
const C = 'academia-gustaviana';

describe('decideCollectionSync', () => {
  it('esimene peegeldus kirjutab kogu URL-i ega lähtesta lehte', () => {
    // `?page=3`-ga saabunud link peab oma lehe alles jätma.
    expect(decideCollectionSync(null, P, null, false, COLLECTIONS))
      .toEqual({ type: 'write-url', value: P, resetPage: false });
  });

  it('kokkulepitud olek on no-op', () => {
    expect(decideCollectionSync(P, P, P, true, COLLECTIONS)).toEqual({ type: 'noop' });
  });

  it('null kirjutatakse sõnaselgelt all-ina', () => {
    expect(decideCollectionSync(null, null, null, false, COLLECTIONS))
      .toEqual({ type: 'write-url', value: ALL_COLLECTIONS, resetPage: false });
  });

  it('päris vahetus kirjutab URL-i ja lähtestab lehe', () => {
    // URL kannab veel seda, milles kokku leppisime → liikus KONTEKST.
    expect(decideCollectionSync(P, C, P, true, COLLECTIONS))
      .toEqual({ type: 'write-url', value: C, resetPage: true });
  });

  it('väline URL-i muutus võidab ja võetakse konteksti', () => {
    // Link `/?collection=klingeriana` või tagasi-nupp: URL-is on midagi, mida
    // meie sinna ei kirjutanud.
    expect(decideCollectionSync('klingeriana', P, P, true, COLLECTIONS))
      .toEqual({ type: 'adopt-url', value: 'klingeriana' });
  });

  it('väline all võetakse konteksti null-ina', () => {
    expect(decideCollectionSync(ALL_COLLECTIONS, P, P, true, COLLECTIONS))
      .toEqual({ type: 'adopt-url', value: null });
  });

  it('tundmatut kogu ei võeta konteksti, vaid URL parandatakse', () => {
    // Kustutatud või ligipääsmatu kogu ei tohi vaadet tühjendada (#323).
    // Leht jääb alles: see ei ole kasutaja tehtud vahetus.
    expect(decideCollectionSync('kadunud', P, P, true, COLLECTIONS))
      .toEqual({ type: 'write-url', value: P, resetPage: false });
  });
});

/**
 * #333: kaks efekti peegeldasid teineteist vastassuundades ja kumbki reageeris
 * teise EELMISELE väärtusele. Ühe sammu faasivahest sündis stabiilne 2-tsükkel,
 * mis kirjutas URL-i ~30 ms tagant kuni brauseri piiranguni.
 *
 * Mudel jooksutab tervet süsteemi: otsus → olek → otsus. Nõue ei ole „ei võngu
 * ühel juhul", vaid „IGA algseis jõuab püsipunkti".
 */
describe('süsteem läheneb püsipunkti', () => {
  const run = (url: string | null, selected: string | null) => {
    let agreed: string | null = null;
    let mirrored = false;
    const seen: string[] = [];
    for (let step = 0; step < 20; step++) {
      const action = decideCollectionSync(url, selected, agreed, mirrored, COLLECTIONS);
      mirrored = true;
      if (action.type === 'noop') { agreed = url; return { steps: step, url, selected, seen }; }
      if (action.type === 'adopt-url') { selected = action.value; agreed = url; }
      else { url = action.value; agreed = action.value; }
      seen.push(String(url));
    }
    throw new Error('ei jõudnud püsipunkti: ' + seen.join(' → '));
  };

  it('faasist väljas paar (kontekst ülem, URL alam) lepib kokku', () => {
    const r = run(C, P);
    expect(r.selected).toBe(C);
    expect(r.url).toBe(C);
    expect(r.steps).toBeLessThanOrEqual(2);
  });

  it('faasist väljas paar teistpidi lepib kokku', () => {
    const r = run(P, C);
    expect(r.selected).toBe(P);
    expect(r.url).toBe(P);
    expect(r.steps).toBeLessThanOrEqual(2);
  });

  it('kõik algseisud jõuavad püsipunkti', () => {
    const values = [null, P, C, 'klingeriana', ALL_COLLECTIONS, 'kadunud'];
    for (const url of values) {
      for (const selected of [null, P, C, 'klingeriana']) {
        expect(() => run(url, selected)).not.toThrow();
      }
    }
  });
});

/**
 * Töökollektsiooni valik käib SAMA otsustaja kaudu (#354).
 *
 * Teist sünkroniseerimisefekti `?set=` jaoks EI lisata: kaks tingimusteta
 * peeglit reageerivad teineteise EELMISELE väärtusele (#333, ADR 0038).
 * Valik serialiseeritakse üheks tokeniks ja antakse olemasolevale otsustajale.
 */
describe('decideCollectionSync: töökollektsioonid', () => {
  const SETS = new Set(['ws_1', 'ws_2']);

  it('töökollektsiooni valik kirjutab URL-i ja lähtestab lehe', () => {
    const action = decideCollectionSync(ALL_COLLECTIONS, 's:ws_1', ALL_COLLECTIONS, true, {}, SETS);
    expect(action).toEqual({ type: 'write-url', value: 's:ws_1', resetPage: true });
  });

  it('teadaolev töökollektsioon lingis võetakse konteksti', () => {
    expect(decideCollectionSync('s:ws_2', 's:ws_1', 's:ws_1', true, COLLECTIONS, SETS))
      .toEqual({ type: 'adopt-url', value: 's:ws_2' });
  });

  it('tundmatu töökollektsioon URL-is ei tühjenda vaadet vaikselt', () => {
    // Ligipääsmatu või kustutatud kogu: URL parandatakse, vaade jääb.
    const action = decideCollectionSync('s:ws_puudub', null, ALL_COLLECTIONS, true, COLLECTIONS, SETS);
    expect(action.type).not.toBe('adopt-url');
    expect(action).toEqual({ type: 'write-url', value: ALL_COLLECTIONS, resetPage: false });
  });

  it('vahetus töökollektsioonilt püsikogule läheb läbi', () => {
    expect(decideCollectionSync('s:ws_1', C, 's:ws_1', true, COLLECTIONS, SETS))
      .toEqual({ type: 'write-url', value: C, resetPage: true });
  });

  it('teadmata kogude hulk (loend veel laadimata) ei võta tokenit vastu', () => {
    // Enne kui `listWorkSets` on vastanud, ei tohi `?set=` omaks võtta —
    // muidu jääks kontekst kogusse, mida ei pruugi olemas olla.
    expect(decideCollectionSync('s:ws_1', null, ALL_COLLECTIONS, true, COLLECTIONS, new Set()).type)
      .not.toBe('adopt-url');
  });

  it('kõik algseisud jõuavad püsipunkti ka tokenitega', () => {
    const run = (url: string | null, selected: string | null) => {
      let agreed: string | null = null;
      let mirrored = false;
      for (let step = 0; step < 20; step++) {
        const action = decideCollectionSync(url, selected, agreed, mirrored, COLLECTIONS, SETS);
        mirrored = true;
        if (action.type === 'noop') return;
        if (action.type === 'adopt-url') { selected = action.value; agreed = url; }
        else { url = action.value; agreed = action.value; }
      }
      throw new Error('ei jõudnud püsipunkti');
    };
    const values = [null, P, C, ALL_COLLECTIONS, 's:ws_1', 's:ws_puudub', 'kadunud'];
    for (const url of values) {
      for (const selected of [null, P, C, 's:ws_1', 's:ws_2']) {
        expect(() => run(url, selected)).not.toThrow();
      }
    }
  });
});
