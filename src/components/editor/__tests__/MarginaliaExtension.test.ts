// src/components/editor/__tests__/MarginaliaExtension.test.ts
import { describe, it, expect } from 'vitest';
import { EditorState } from '@codemirror/state';
import {
  marginaliaExtension,
  marginaliaField,
  marginaliaDecoField,
  openMarginalia,
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
