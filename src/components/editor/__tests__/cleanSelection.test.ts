// src/components/editor/__tests__/cleanSelection.test.ts
import { describe, it, expect } from 'vitest';
import { EditorState } from '@codemirror/state';
import { cleanSelectionChanges } from '../cleanSelection';

// Valik märgitakse dokumendis ⟦ … ⟧ märkidega.
function puhasta(marked: string, hidden: { from: number; to: number }[] = []): string {
  const from = marked.indexOf('⟦');
  const to = marked.indexOf('⟧') - 1;
  const doc = marked.replace('⟦', '').replace('⟧', '');
  const state = EditorState.create({ doc });
  return state.update({ changes: cleanSelectionChanges(doc, from, to, hidden) }).state.doc.toString();
}

describe('cleanSelectionChanges — valik paari sees poolitab paari', () => {
  it('kolm sõna keset f-rida', () => {
    expect(puhasta('<f>aa ⟦bb cc dd⟧ ee</f>')).toBe('<f>aa </f>bb cc dd<f> ee</f>');
  });

  it('valik paari alguses', () => {
    expect(puhasta('<f>⟦aa bb⟧ cc</f>')).toBe('aa bb<f> cc</f>');
  });

  it('valik paari lõpus', () => {
    expect(puhasta('<i>aa ⟦bb⟧</i> cc')).toBe('<i>aa </i>bb cc');
  });

  it('servade tühikud jäävad valikust välja', () => {
    expect(puhasta('<i>a⟦ b ⟧c</i>')).toBe('<i>a </i>b<i> c</i>');
  });

  it('ainult tühikuks jääv pool kaob koos oma tägiga', () => {
    expect(puhasta('<i> ⟦a⟧</i>')).toBe(' a');
  });

  it('pesastatud stiilid: sisemine suletakse enne, avatakse pärast', () => {
    expect(puhasta('<i>a <b>b ⟦c⟧ d</b> e</i>')).toBe('<i>a <b>b </b></i>c<i><b> d</b> e</i>');
  });

  it('mitmerealine paar', () => {
    expect(puhasta('<i>aa\nb⟦b⟧ cc</i>')).toBe('<i>aa\nb</i>b<i> cc</i>');
  });
});

describe('cleanSelectionChanges — valik ületab paari piiri', () => {
  it('valik algab paari sees ja lõpeb väljas: puhastub ainult valitud osa', () => {
    expect(puhasta('<i>aa ⟦bb</i> cc⟧ dd')).toBe('<i>aa </i>bb cc dd');
  });

  it('valik algab väljas ja lõpeb paari sees', () => {
    expect(puhasta('aa ⟦bb <i>cc⟧ dd</i>')).toBe('aa bb cc<i> dd</i>');
  });

  it('mitu rida, igal oma paar', () => {
    expect(puhasta('<i>aa ⟦bb</i>\n<i>cc⟧ dd</i>')).toBe('<i>aa </i>bb\ncc<i> dd</i>');
  });

  it('paar tervikuna valikus kaob', () => {
    expect(puhasta('x ⟦<i>a</i> b⟧')).toBe('x a b');
  });

  it('ilma tägideta valik ei muuda midagi', () => {
    expect(cleanSelectionChanges('aa bb', 0, 5, [])).toEqual([]);
  });
});

describe('cleanSelectionChanges — struktuur ja säilivad tägid', () => {
  it('<m> jääb alles, kui valik on tema sees', () => {
    expect(puhasta('<m><i>a ⟦b⟧ c</i></m>')).toBe('<m><i>a </i>b<i> c</i></m>');
  });

  it('annotatsioon ümber: jääb puutumata', () => {
    expect(puhasta('<ann1><i>a ⟦b⟧ c</i></ann1>')).toBe('<ann1><i>a </i>b<i> c</i></ann1>');
  });

  it('annotatsioon stiili sees: lõige liigub ankru ümber, ristuvat pesastust ei teki', () => {
    expect(puhasta('<i>a <ann1>b ⟦c⟧</ann1> d</i>')).toBe('<i>a </i><ann1>b c</ann1><i> d</i>');
  });

  it('joonealune viide ja pb valikus eemaldatakse', () => {
    expect(puhasta('⟦a <fn>1</fn> b<pb/>⟧')).toBe('a 1 b');
  });

  it('peidetud marginaaliaplokki ei puudutata', () => {
    const doc = 'AA <i>x</i>\n<m>note</m>\nBB';
    // peidetud vahemik: '<m>note</m>\n' = 12..24
    const state = EditorState.create({ doc });
    const out = state.update({
      changes: cleanSelectionChanges(doc, 0, doc.length, [{ from: 12, to: 24 }]),
    }).state.doc.toString();
    expect(out).toBe('AA x\n<m>note</m>\nBB');
  });

  it('mitu peidetud plokki — kõik jäävad puutumata', () => {
    const doc = 'A\n<m>a</m>\n<b>B</b>\n<m>b</m>\nC';
    // plokid: '<m>a</m>\n' = 2..11, '<m>b</m>\n' = 20..29
    const specs = cleanSelectionChanges(doc, 0, doc.length, [{ from: 2, to: 11 }, { from: 20, to: 29 }]);
    for (const c of specs) expect(c.from >= 29 || c.to <= 20).toBe(true);
    for (const c of specs) expect(c.from >= 11 || c.to <= 2).toBe(true);
    const out = EditorState.create({ doc }).update({ changes: specs }).state.doc.toString();
    expect(out).toBe('A\n<m>a</m>\nB\n<m>b</m>\nC');
  });

  it('valik algab peidetud ploki sees — plokki ei puudutata', () => {
    const doc = 'AA\n<m>note</m>\n<i>BB</i>';
    // peidetud: '<m>note</m>\n' = 3..15
    const specs = cleanSelectionChanges(doc, 5, doc.length, [{ from: 3, to: 15 }]);
    const out = EditorState.create({ doc }).update({ changes: specs }).state.doc.toString();
    expect(out).toBe('AA\n<m>note</m>\nBB');
  });
});
