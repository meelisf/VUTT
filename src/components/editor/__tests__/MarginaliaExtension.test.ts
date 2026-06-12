// src/components/editor/__tests__/MarginaliaExtension.test.ts
import { describe, it, expect } from 'vitest';
import { EditorState, Transaction } from '@codemirror/state';
import {
  marginaliaExtension,
  marginaliaField,
  marginaliaDecoField,
  openMarginalia,
  closeMarginalia,
  closeAllMarginalia,
  hiddenBlockRanges,
  deleteMarginaliaSpec,
} from '../MarginaliaExtension';
import { cleanMarkupSpecs, marginaliaFromSelection } from '../../../utils/marginaliaUtils';

const DOC = 'rida üks\n<m>Apoc. 12.</m>\nrida kaks\n<m>Vide Picrium</m>\nrida kolm';

function mkState(doc = DOC) {
  return EditorState.create({ doc, extensions: [marginaliaExtension('column')] });
}

describe('marginaliaField', () => {
  it('parsib plokid dokumendist', () => {
    const state = mkState();
    expect(state.field(marginaliaField).blocks).toHaveLength(2);
  });

  it('openMarginalia avab ploki, closeAllMarginalia sulgeb', () => {
    let state = mkState();
    const b = state.field(marginaliaField).blocks[0];
    state = state.update({ effects: openMarginalia.of(b.contentFrom) }).state;
    expect(state.field(marginaliaField).openMarks).toHaveLength(1);
    state = state.update({ effects: closeAllMarginalia.of(null) }).state;
    expect(state.field(marginaliaField).openMarks).toHaveLength(0);
  });

  it('avatud marker säilib dokumendimuudatuse läbi (mapitakse)', () => {
    let state = mkState();
    const b = state.field(marginaliaField).blocks[0];
    state = state.update({ effects: openMarginalia.of(b.contentFrom) }).state;
    // Lisa teksti dokumendi algusesse — marker peab nihkuma kaasa
    state = state.update({ changes: { from: 0, insert: 'XX' } }).state;
    const { blocks, openMarks } = state.field(marginaliaField);
    expect(openMarks[0]).toBe(b.contentFrom + 2);
    expect(openMarks[0]).toBeGreaterThanOrEqual(blocks[0].from);
    expect(openMarks[0]).toBeLessThanOrEqual(blocks[0].to);
  });
});

it('closeMarginalia sulgeb ainult selle ploki', () => {
  let state = mkState();
  const [b1, b2] = state.field(marginaliaField).blocks;
  state = state.update({ effects: [openMarginalia.of(b1.contentFrom), openMarginalia.of(b2.contentFrom)] }).state;
  state = state.update({ effects: closeMarginalia.of(b1.from + 1) }).state;
  const { blocks, openMarks } = state.field(marginaliaField);
  expect(openMarks).toHaveLength(1);
  expect(openMarks[0]).toBeGreaterThanOrEqual(blocks[1].from);
});

describe('dekoratsioonid', () => {
  it('suletud plokid annavad replace + widget dekoratsioonid (2 plokki → 4 dekoratsiooni)', () => {
    const state = mkState();
    expect(state.field(marginaliaDecoField).deco.size).toBe(4);
  });

  it('dokumendi lõpus olevad järjestikused plokid ei viska erandit', () => {
    const state = mkState('tekst\n<m>a</m>\n<m>b</m>');
    expect(state.field(marginaliaField).blocks).toHaveLength(2);
    expect(state.field(marginaliaDecoField).deco.size).toBeGreaterThan(0);
  });

  it('avatud plokk annab line-dekoratsioonid + × widgeti', () => {
    let state = mkState();
    const b = state.field(marginaliaField).blocks[0];
    state = state.update({ effects: openMarginalia.of(b.contentFrom) }).state;
    // Plokk 1 avatud (1 rida): 1 line-deco + 1 close-widget; plokk 2 suletud: replace + note-widget
    expect(state.field(marginaliaDecoField).deco.size).toBe(4);
  });
});

describe('marginaliaProtectionFilter', () => {
  it('kasutaja kustutamine üle peidetud ploki jätab ploki alles', () => {
    const doc = 'AAAA\n<m>note</m>\nBBBB';
    let state = mkState(doc);
    // Kustuta kogu dokument kasutaja-eventina
    state = state.update({
      changes: { from: 0, to: doc.length, insert: '' },
      annotations: Transaction.userEvent.of('delete.selection'),
    }).state;
    expect(state.doc.toString()).toContain('<m>note</m>');
    expect(state.doc.toString()).not.toContain('AAAA');
    expect(state.doc.toString()).not.toContain('BBBB');
  });

  it('avatud ploki kustutamine on lubatud', () => {
    const doc = 'AAAA\n<m>note</m>\nBBBB';
    let state = mkState(doc);
    const b = state.field(marginaliaField).blocks[0];
    state = state.update({ effects: openMarginalia.of(b.contentFrom) }).state;
    state = state.update({
      changes: { from: 0, to: doc.length, insert: '' },
      annotations: Transaction.userEvent.of('delete.selection'),
    }).state;
    expect(state.doc.toString()).toBe('');
  });

  it('programmiline muudatus (ilma userEventita) läheb läbi puutumata', () => {
    const doc = 'AAAA\n<m>note</m>\nBBBB';
    let state = mkState(doc);
    state = state.update({ changes: { from: 0, to: doc.length, insert: 'uus' } }).state;
    expect(state.doc.toString()).toBe('uus');
  });

  it('tavaline kustutamine nähtavas tekstis töötab', () => {
    const doc = 'AAAA\n<m>note</m>\nBBBB';
    let state = mkState(doc);
    state = state.update({
      changes: { from: 0, to: 2, insert: '' },
      annotations: Transaction.userEvent.of('delete.backward'),
    }).state;
    expect(state.doc.toString()).toBe('AA\n<m>note</m>\nBBBB');
  });
});

describe('hiddenBlockRanges', () => {
  it('tagastab suletud plokkide peitevahemikud', () => {
    const state = mkState('AA <i>x</i>\n<m>note</m>\nBB');
    const blocks = state.field(marginaliaField).blocks;
    expect(blocks).toHaveLength(1);
    const ranges = hiddenBlockRanges(state);
    expect(ranges).toEqual([{ from: blocks[0].hideFrom, to: blocks[0].hideTo }]);
  });

  it('avatud plokk ei ole peidetud', () => {
    let state = mkState('AA\n<m>note</m>\nBB');
    const b = state.field(marginaliaField).blocks[0];
    state = state.update({ effects: openMarginalia.of(b.contentFrom) }).state;
    expect(hiddenBlockRanges(state)).toHaveLength(0);
  });
});

describe('cleanMarkup peidetud marginaalia üle (simulatsioon)', () => {
  it('peidetud ploki sisu ei dubleerita insert-teksti', () => {
    // Simuleerib TextEditor.cleanMarkup dispatchi: peidetud vahemikud lõigatakse
    // valikust välja ENNE tägide eemaldamist; kaitsefilter hoiab ploki dokis alles.
    const doc = 'AA <i>x</i>\n<m>note</m>\nBB';
    let state = mkState(doc);
    const hidden = hiddenBlockRanges(state);
    let visible = '';
    let cursor = 0;
    for (const h of hidden) {
      visible += doc.slice(cursor, h.from);
      cursor = Math.max(cursor, h.to);
    }
    visible += doc.slice(cursor);
    const cleaned = visible.replace(/<\/?(?:i|b|cs|m|hi|fn|pb)[^>]*>/g, '');

    state = state.update({
      changes: { from: 0, to: doc.length, insert: cleaned },
      annotations: Transaction.userEvent.of('input.format'),
    }).state;

    const result = state.doc.toString();
    // Plokk säilib täpselt üks kord ja 'note' ei esine väljaspool tägi
    expect(result.match(/<m>note<\/m>/g)).toHaveLength(1);
    expect(result.replace('<m>note</m>', '')).not.toContain('note');
    // Nähtav tekst on puhastatud
    expect(result).toContain('AA x');
    expect(result).not.toContain('<i>');
  });
});

describe('marginaliaProtectionFilter edastab effects', () => {
  it('ümberkirjutatud tehing säilitab tr.effects (closeAllMarginalia koos kustutusega)', () => {
    const doc = 'AA\n<m>one</m>\nBB\n<m>two</m>\nCC';
    let state = mkState(doc);
    const b2 = state.field(marginaliaField).blocks[1];
    state = state.update({ effects: openMarginalia.of(b2.contentFrom) }).state;
    expect(state.field(marginaliaField).openMarks).toHaveLength(1);

    // Kustutus üle PEIDETUD ploki 1 → filter kirjutab tehingu ümber;
    // kaasapandud closeAllMarginalia efekt peab ikkagi mõjuma
    state = state.update({
      changes: { from: 0, to: 16, insert: '' },
      effects: closeAllMarginalia.of(null),
      annotations: Transaction.userEvent.of('delete.selection'),
    }).state;
    expect(state.field(marginaliaField).openMarks).toHaveLength(0);
    expect(state.doc.toString()).toContain('<m>one</m>');
  });
});

describe('lehevahetuse fix: closeAllMarginalia koos dokumendiasendusega', () => {
  it('kogu dok asendus + closeAllMarginalia tühjendab openMarks (vanad positsioonid ei jää)', () => {
    // Avame ploki, seejärel asendame kogu dokumendi koos closeAll efektiga —
    // see simuleerib TextEditor lehevahetuse dispatch'd.
    // Ilma closeAll-ita mapitaks vana marker pos 0-le ja avaks ploki uuel lehel
    // (kui uus dok algab <m>-iga).
    let state = mkState();
    const b = state.field(marginaliaField).blocks[0];
    state = state.update({ effects: openMarginalia.of(b.contentFrom) }).state;
    expect(state.field(marginaliaField).openMarks).toHaveLength(1);

    // Lehevahetusel: asendame kogu dok + saadame closeAllMarginalia
    const newDoc = '<m>uus marginaalia</m>\nrida';
    state = state.update({
      changes: { from: 0, to: state.doc.length, insert: newDoc },
      effects: closeAllMarginalia.of(null),
    }).state;

    // openMarks peab olema tühi — closeAll võidab mapping'u üle
    expect(state.field(marginaliaField).openMarks).toHaveLength(0);
    // Veendume, et uus dok on õige (1 plokk)
    expect(state.field(marginaliaField).blocks).toHaveLength(1);
  });
});

describe('cleanMarkup per-segment dispatch (uus käitumine)', () => {
  it('peidetud plokk jääb oma reale ja PLOKINA alles', () => {
    const doc = 'AA <i>x</i>\n<m>note</m>\nBB';
    let state = mkState(doc);
    const hidden = hiddenBlockRanges(state);
    const specs = cleanMarkupSpecs(
      doc, 0, doc.length, hidden,
      s => s.replace(/<\/?(?:i|b|cs|m|hi|fn|pb)[^>]*>/g, ''),
    );
    state = state.update({
      changes: state.changes(specs),
      annotations: Transaction.userEvent.of('input.format'),
    }).state;

    expect(state.doc.toString()).toBe('AA x\n<m>note</m>\nBB');
    // Plokk on endiselt PLOKK-marginaalia (mitte inline) — parser tunneb ära
    expect(state.field(marginaliaField).blocks).toHaveLength(1);
  });

  it('mitu plokki valikus — kõik jäävad oma kohale', () => {
    const doc = 'A <b>q</b>\n<m>one</m>\nB\n<m>two</m>\nC <i>z</i>';
    let state = mkState(doc);
    const hidden = hiddenBlockRanges(state);
    const specs = cleanMarkupSpecs(
      doc, 0, doc.length, hidden,
      s => s.replace(/<\/?(?:i|b|cs|m|hi|fn|pb)[^>]*>/g, ''),
    );
    state = state.update({
      changes: state.changes(specs),
      annotations: Transaction.userEvent.of('input.format'),
    }).state;

    expect(state.doc.toString()).toBe('A q\n<m>one</m>\nB\n<m>two</m>\nC z');
    expect(state.field(marginaliaField).blocks).toHaveLength(2);
  });
});

describe('insertMarginalia valikuga (simulatsioon)', () => {
  it('valik tõuseb plokki, peidetud plokk jääb alles ega dubleeru', () => {
    const doc = 'pealkiri\nvalitud tekst\n<m>vana</m>\nlõpp';
    let state = mkState(doc);
    const from = doc.indexOf('valitud');
    const to = doc.length; // valik üle peidetud ploki kuni lõpuni
    const hidden = hiddenBlockRanges(state).filter(h => h.from < to && h.to > from);
    const { changes } = marginaliaFromSelection(doc, from, to, hidden);
    state = state.update({
      changes,
      annotations: Transaction.userEvent.of('input.format'),
    }).state;

    const result = state.doc.toString();
    // uus plokk valiku algusrea kohal, sisus AINULT nähtav tekst
    expect(result).toContain('<m>valitud tekst\nlõpp</m>');
    // vana plokk säilib täpselt üks kord
    expect(result.match(/<m>vana<\/m>/g)).toHaveLength(1);
    // 'vana' ei esine väljaspool oma tägi
    expect(result.replace('<m>vana</m>', '')).not.toContain('vana');
  });
});

describe('paste avatud plokki', () => {
  it('insert avatud ploki sisu positsioonil läbib filtrid', () => {
    const doc = 'rida\n<m></m>\nlõpp';
    let state = mkState(doc);
    const b = state.field(marginaliaField).blocks[0];
    state = state.update({ effects: openMarginalia.of(b.contentFrom) }).state;
    // paste kursoriga contentFrom-il (tühi plokk: contentFrom === contentTo)
    state = state.update({
      changes: { from: b.contentFrom, to: b.contentFrom, insert: 'kleebitud' },
      annotations: Transaction.userEvent.of('input.paste'),
    }).state;
    expect(state.doc.toString()).toContain('<m>kleebitud</m>');
  });
});

describe('deleteMarginaliaSpec', () => {
  it('kustutab ploki täielikult (rida + reavahetus), ilma userEvent\'ita läbib filtrid', () => {
    const doc = 'rida üks\n<m>kustutatav</m>\nrida kaks';
    let state = mkState(doc);
    const b = state.field(marginaliaField).blocks[0];
    const spec = deleteMarginaliaSpec(state, b.from);
    expect(spec).not.toBeNull();
    state = state.update({ changes: spec! }).state;
    expect(state.doc.toString()).toBe('rida üks\nrida kaks');
    expect(state.field(marginaliaField).blocks).toHaveLength(0);
  });

  it('avatud ploki kustutus töötab samuti', () => {
    const doc = 'a\n<m>note</m>\nb';
    let state = mkState(doc);
    const b = state.field(marginaliaField).blocks[0];
    state = state.update({ effects: openMarginalia.of(b.contentFrom) }).state;
    const spec = deleteMarginaliaSpec(state, b.from);
    state = state.update({ changes: spec! }).state;
    expect(state.doc.toString()).toBe('a\nb');
  });

  it('olematu blockFrom annab null', () => {
    const state = mkState('tekst ilma plokita');
    expect(deleteMarginaliaSpec(state, 5)).toBeNull();
  });
});
