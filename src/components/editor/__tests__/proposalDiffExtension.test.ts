// #641: agendi ettepaneku diff redaktoris — lisatu mark, kustutatu lugemiseks widget.
import { describe, it, expect } from 'vitest';
import { EditorState } from '@codemirror/state';
import {
  proposalDiffExtension, proposalDiffField, proposalRanges, setProposalBase,
} from '../proposalDiffExtension';

const decos = (state: EditorState) => {
  const out: { from: number; to: number; cls?: string; widget?: string }[] = [];
  state.field(proposalDiffField).deco.between(0, state.doc.length, (from, to, d) => {
    const spec = d.spec as { class?: string; widget?: { text: string } };
    out.push({ from, to, cls: spec.class, widget: spec.widget?.text });
  });
  return out;
};

describe('proposalRanges', () => {
  it('lisatu ja kustutatu asukohad', () => {
    expect(proposalRanges('a vana b', 'a uus b')).toEqual({ ins: [[2, 5]], del: [{ pos: 2, text: 'vana' }] });
  });

  it('kustutust <pb/> sees ei näidata', () => {
    const r = proposalRanges('x <pb/> y', 'x <pb/> y z');
    expect(r.del).toEqual([]);
  });
});

describe('proposalDiffExtension', () => {
  it('base seatud → dekoratsioonid; null → mitte midagi', () => {
    let state = EditorState.create({ doc: 'a uus b', extensions: [proposalDiffExtension()] });
    expect(decos(state)).toEqual([]);
    state = state.update({ effects: setProposalBase.of('a vana b') }).state;
    expect(decos(state)).toEqual([
      { from: 2, to: 2, cls: undefined, widget: 'vana' },
      { from: 2, to: 5, cls: 'vutt-prop-ins', widget: undefined },
    ]);
    state = state.update({ effects: setProposalBase.of(null) }).state;
    expect(decos(state)).toEqual([]);
  });

  it('dokumendi muutus arvutab uuesti', () => {
    let state = EditorState.create({ doc: 'a uus b', extensions: [proposalDiffExtension()] });
    state = state.update({ effects: setProposalBase.of('a vana b') }).state;
    state = state.update({ changes: { from: 2, to: 5, insert: 'vana' } }).state;
    expect(decos(state)).toEqual([]);
  });
});
