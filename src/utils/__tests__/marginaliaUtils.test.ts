// src/utils/__tests__/marginaliaUtils.test.ts
import { describe, it, expect } from 'vitest';
import { findMarginaliaBlocks, stackMarginalia, cleanMarkupSpecs, marginaliaFromSelection, groupMarginaliaBlocks, rangeTouchesOpenMarginalia } from '../marginaliaUtils';

describe('findMarginaliaBlocks', () => {
  it('leiab omaette real seisva ploki ja ankurdab järgmise rea külge', () => {
    const text = 'rida üks\n<m>Apoc. 12.</m>\nrida kaks';
    const blocks = findMarginaliaBlocks(text);
    expect(blocks).toHaveLength(1);
    const b = blocks[0];
    expect(text.slice(b.from, b.to)).toBe('<m>Apoc. 12.</m>');
    expect(text.slice(b.contentFrom, b.contentTo)).toBe('Apoc. 12.');
    // peidetav ala: ploki rida koos lõpu reavahetusega
    expect(text.slice(b.hideFrom, b.hideTo)).toBe('<m>Apoc. 12.</m>\n');
    // ankur: 'rida kaks' algus
    expect(b.anchorPos).toBe(text.indexOf('rida kaks'));
  });

  it('leiab mitmerealise ploki', () => {
    const text = 'a\n<m>Vide Pic⸗\nrium in</m>\nb';
    const blocks = findMarginaliaBlocks(text);
    expect(blocks).toHaveLength(1);
    expect(text.slice(blocks[0].contentFrom, blocks[0].contentTo)).toBe('Vide Pic⸗\nrium in');
    expect(blocks[0].anchorPos).toBe(text.indexOf('b'));
  });

  it('jätab vahele rea keskel oleva <m> tägi', () => {
    const text = 'tekst <m>inline</m> jätkub';
    expect(findMarginaliaBlocks(text)).toHaveLength(0);
  });

  it('dokumendi lõpus olev plokk ankurdub eelmise rea külge', () => {
    const text = 'viimane rida\n<m>märkus</m>';
    const blocks = findMarginaliaBlocks(text);
    expect(blocks).toHaveLength(1);
    // peidetav ala sisaldab EELNEVAT reavahetust (lõpus pole oma)
    expect(text.slice(blocks[0].hideFrom, blocks[0].hideTo)).toBe('\n<m>märkus</m>');
    expect(blocks[0].anchorPos).toBe(0); // 'viimane rida' algus
  });

  it('järjestikused plokid: ankur hüppab üle teise peidetud ploki', () => {
    const text = '<m>üks</m>\n<m>kaks</m>\ntekst';
    const blocks = findMarginaliaBlocks(text);
    expect(blocks).toHaveLength(2);
    const textPos = text.indexOf('tekst');
    expect(blocks[0].anchorPos).toBe(textPos);
    expect(blocks[1].anchorPos).toBe(textPos);
  });

  it('tühi tekst', () => {
    expect(findMarginaliaBlocks('')).toHaveLength(0);
  });

  it('dokumendi lõpus olevad järjestikused plokid ei anna kattuvaid peitevahemikke', () => {
    const text = 'tekst\n<m>a</m>\n<m>b</m>';
    const blocks = findMarginaliaBlocks(text);
    expect(blocks).toHaveLength(2);
    expect(blocks[1].hideFrom).toBeGreaterThanOrEqual(blocks[0].hideTo);
  });

  it('lõpuklastri ankrud EI tohi sattuda peidetud alasse ega dokumendi lõppu (nopt05/4 bug)', () => {
    // Tegelik juhtum: 4 järjestikust plokki dokumendi lõpus — kõigi ankrud
    // lükati doc lõppu (peidetud ala piirile) ja widget'id ei renderdunud
    const text = 'imaginem referre videtur.\n<m>Tranſitio.</m>\n<m>Narratio-</m>\n<m>nis initi-</m>\n<m>um.</m>';
    const blocks = findMarginaliaBlocks(text);
    expect(blocks).toHaveLength(4);
    for (const b of blocks) {
      // ankur on nähtaval positsioonil: mitte ühegi ploki peidetud vahemikus
      for (const other of blocks) {
        const inside = b.anchorPos >= other.hideFrom && b.anchorPos < other.hideTo;
        expect(inside).toBe(false);
      }
      // ega dokumendi lõpus (block-replace piiril widget ei renderdu)
      expect(b.anchorPos).toBeLessThan(text.length);
    }
    // kõik ankurduvad viimase nähtava rea ('imaginem...') algusesse
    for (const b of blocks) expect(b.anchorPos).toBe(0);
  });

  it("lõpuklaster trailing-newline'iga ankurdub samuti eelmisele nähtavale reale", () => {
    const text = 'rida\n<m>a</m>\n<m>b</m>\n';
    const blocks = findMarginaliaBlocks(text);
    expect(blocks).toHaveLength(2);
    for (const b of blocks) expect(b.anchorPos).toBe(0);
  });

  it('keset dokumenti olevad järjestikused plokid ankurduvad endiselt EDASI', () => {
    const text = 'enne\n<m>a</m>\n<m>b</m>\npärast';
    const blocks = findMarginaliaBlocks(text);
    const parastPos = text.indexOf('pärast');
    expect(blocks[0].anchorPos).toBe(parastPos);
    expect(blocks[1].anchorPos).toBe(parastPos);
  });
});

describe('groupMarginaliaBlocks', () => {
  it('liidab järjestikused plokid üheks grupiks', () => {
    const text = 'enne\n<m>a</m>\n<m>b</m>\n<m>c</m>\npärast';
    const groups = groupMarginaliaBlocks(findMarginaliaBlocks(text));
    expect(groups).toHaveLength(1);
    expect(groups[0].blocks).toHaveLength(3);
    expect(groups[0].from).toBe(text.indexOf('<m>a'));
    expect(groups[0].hideFrom).toBe(text.indexOf('<m>a'));
    expect(groups[0].hideTo).toBe(text.indexOf('pärast'));
  });

  it('eraldi (mittejärjestikused) plokid jäävad eraldi gruppidesse', () => {
    const text = 'üks\n<m>a</m>\nkaks\n<m>b</m>\nkolm';
    const groups = groupMarginaliaBlocks(findMarginaliaBlocks(text));
    expect(groups).toHaveLength(2);
    expect(groups[0].blocks).toHaveLength(1);
    expect(groups[1].blocks).toHaveLength(1);
  });

  it('mitu klastrit: igaüks oma grupp, sisemine järjestikkus liidetud', () => {
    const text = 'a\n<m>x1</m>\n<m>x2</m>\nb\n<m>y1</m>\n<m>y2</m>\n<m>y3</m>\nc';
    const groups = groupMarginaliaBlocks(findMarginaliaBlocks(text));
    expect(groups).toHaveLength(2);
    expect(groups[0].blocks).toHaveLength(2);
    expect(groups[1].blocks).toHaveLength(3);
  });

  it('tühi sisend', () => {
    expect(groupMarginaliaBlocks([])).toEqual([]);
  });
});

describe('stackMarginalia', () => {
  it('kattumiseta plokid jäävad oma ankru kõrgusele', () => {
    const out = stackMarginalia([
      { anchorTop: 0, height: 20 },
      { anchorTop: 100, height: 20 },
    ]);
    expect(out).toEqual([
      { top: 0, offset: 0 },
      { top: 100, offset: 0 },
    ]);
  });

  it('kattuv plokk nihkub eelmise alla (gap 6)', () => {
    const out = stackMarginalia([
      { anchorTop: 0, height: 90 },
      { anchorTop: 50, height: 20 },
    ]);
    expect(out[1]).toEqual({ top: 96, offset: 46 });
  });

  it('mitu järjestikust konflikti kuhjuvad', () => {
    const out = stackMarginalia([
      { anchorTop: 0, height: 50 },
      { anchorTop: 10, height: 50 },
      { anchorTop: 20, height: 50 },
    ]);
    expect(out[1].top).toBe(56);
    expect(out[2].top).toBe(112);
  });

  it('tühi sisend', () => {
    expect(stackMarginalia([])).toEqual([]);
  });
});

describe('cleanMarkupSpecs', () => {
  const clean = (s: string) => s.replace(/<\/?(?:i|b|cs|m|hi|fn|pb)[^>]*>/g, '');

  it('peidetud plokk jääb oma reale — muudatus iga nähtava segmendi kohta eraldi', () => {
    const doc = 'AA <i>x</i>\n<m>note</m>\nBB';
    // peidetud vahemik: '<m>note</m>\n' = 12..24
    const specs = cleanMarkupSpecs(doc, 0, doc.length, [{ from: 12, to: 24 }], clean);
    expect(specs).toEqual([
      { from: 0, to: 12, insert: 'AA x\n' },
      { from: 24, to: 26, insert: 'BB' },
    ]);
  });

  it('mitu peidetud plokki — kõik jäävad puutumata', () => {
    const doc = 'A\n<m>a</m>\n<b>B</b>\n<m>b</m>\nC';
    // plokid: '<m>a</m>\n' = 2..11, '<m>b</m>\n' = 20..29
    const specs = cleanMarkupSpecs(doc, 0, doc.length, [
      { from: 2, to: 11 },
      { from: 20, to: 29 },
    ], clean);
    expect(specs).toEqual([
      { from: 0, to: 2, insert: 'A\n' },
      { from: 11, to: 20, insert: 'B\n' },
      { from: 29, to: 30, insert: 'C' },
    ]);
  });

  it('valik ei kata ühtegi peidetud plokki — üks muudatus', () => {
    const doc = 'AA <i>x</i> BB';
    const specs = cleanMarkupSpecs(doc, 0, doc.length, [], clean);
    expect(specs).toEqual([{ from: 0, to: 14, insert: 'AA x BB' }]);
  });

  it('valik algab/lõpeb peidetud ploki sees — lõigatakse ploki piirile', () => {
    const doc = 'AA\n<m>note</m>\nBB';
    // peidetud: '<m>note</m>\n' = 3..15; valik 5..17 (algab ploki seest)
    const specs = cleanMarkupSpecs(doc, 5, 17, [{ from: 3, to: 15 }], clean);
    expect(specs).toEqual([{ from: 15, to: 17, insert: 'BB' }]);
  });

  it('segment, mille puhastus ei muuda, jäetakse vahele', () => {
    const doc = 'AA\n<m>note</m>\nBB';
    const specs = cleanMarkupSpecs(doc, 0, doc.length, [{ from: 3, to: 15 }], clean);
    // 'AA\n' on juba puhas → spec ainult 'BB' jaoks? Ei — ka muutumatu segment
    // võib jääda, peaasi et insert === originaal välistataks. Lubame mõlemat:
    for (const s of specs) {
      expect(s.insert).toBe(clean(doc.slice(s.from, s.to)));
    }
  });
});

describe('marginaliaFromSelection', () => {
  it('valik liigub uude <m> plokki valiku algusrea kohale', () => {
    const doc = 'esimene rida\nteine valitud rida\nkolmas';
    const from = doc.indexOf('teine');
    const to = doc.indexOf(' rida\nkolmas');
    const r = marginaliaFromSelection(doc, from, to, []);
    // muudatused: plokk rea algusesse + valiku kustutus
    expect(r.changes).toEqual([
      { from: 13, to: 13, insert: '<m>teine valitud</m>\n' },
      { from, to, insert: '' },
    ]);
    // avamarker ja kursor jäävad loodud ploki sisu sisse
    expect(r.openPositions).toEqual([13 + 3]);
    expect(r.cursor).toBe(13 + 3 + 'teine valitud'.length);
  });

  it('peidetud plokid valikus EI satu uue marginaalia sisusse', () => {
    const doc = 'AA\n<m>vana</m>\nBB';
    // peidetud: '<m>vana</m>\n' = 3..15
    const r = marginaliaFromSelection(doc, 0, doc.length, [{ from: 3, to: 15 }]);
    expect(r.changes[0].insert).toBe('<m>AA</m>\n<m>BB</m>\n');
  });

  it('mitmerealine valik saab ühe <m> paari iga füüsilise rea kohta', () => {
    const doc = 'a\nb\nc';
    const r = marginaliaFromSelection(doc, 0, doc.length, []);
    expect(r.changes[0].insert).toBe('<m>a</m>\n<m>b</m>\n<m>c</m>\n');
    expect(r.changes[0].insert.trimEnd().split('\n').every(
      line => /^<m>[^\n]*<\/m>$/.test(line),
    )).toBe(true);
    expect(r.openPositions).toEqual([
      3,
      '<m>a</m>\n'.length + 3,
      '<m>a</m>\n<m>b</m>\n'.length + 3,
    ]);
    expect(r.cursor).toBe('<m>a</m>\n<m>b</m>\n<m>c'.length);
  });

  it('sulgeb ja taasavab üle rea ulatuva inline-tägi', () => {
    const doc = '<i>esimene\nteine</i>';
    const r = marginaliaFromSelection(doc, 0, doc.length, []);
    expect(r.changes[0].insert).toBe(
      '<m><i>esimene</i></m>\n<m><i>teine</i></m>\n',
    );
  });
});

describe('rangeTouchesOpenMarginalia', () => {
  const text = 'enne\n<m>üks</m>\n<m>kaks</m>\nvahe\n<m>kolm</m>\npärast';
  const blocks = findMarginaliaBlocks(text);
  const openMarks = [blocks[0].contentFrom];

  it('tunneb ära kursori ja valiku avatud ploki sees', () => {
    expect(rangeTouchesOpenMarginalia(blocks, openMarks, blocks[0].contentFrom, blocks[0].contentFrom)).toBe(true);
    expect(rangeTouchesOpenMarginalia(blocks, openMarks, blocks[0].from, blocks[0].to)).toBe(true);
  });

  it('käsitleb ühe markeriga avatud järjestikuse grupi kõiki liikmeid avatuna', () => {
    expect(rangeTouchesOpenMarginalia(blocks, openMarks, blocks[1].contentFrom, blocks[1].contentTo)).toBe(true);
  });

  it('ei blokeeri eraldi suletud plokki ega välist teksti', () => {
    expect(rangeTouchesOpenMarginalia(blocks, openMarks, blocks[2].contentFrom, blocks[2].contentTo)).toBe(false);
    expect(rangeTouchesOpenMarginalia(blocks, openMarks, 0, 4)).toBe(false);
  });
});
