// src/components/editor/__tests__/MarginaliaExtension.test.ts
import { describe, it, expect } from 'vitest';
import { EditorState } from '@codemirror/state';
import { Transaction } from '@codemirror/state';
import {
  marginaliaExtension,
  marginaliaField,
  marginaliaDecoField,
  openMarginalia,
  closeMarginalia,
  closeAllMarginalia,
} from '../MarginaliaExtension';

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
