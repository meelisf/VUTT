// src/components/editor/__tests__/wrapTagUtils.test.ts
import { describe, it, expect } from 'vitest';
import { EditorState } from '@codemirror/state';
import { selectionWrapChanges } from '../wrapTagUtils';

// Valik märgitakse dokumendis ⟦ … ⟧ märkidega.
function lulita(marked: string, tag = 'i'): string {
  const from = marked.indexOf('⟦');
  const to = marked.indexOf('⟧') - 1;
  const doc = marked.replace('⟦', '').replace('⟧', '');
  const state = EditorState.create({ doc, selection: { anchor: from, head: to } });
  return state.update({ changes: selectionWrapChanges(state, tag) }).state.doc.toString();
}

describe('selectionWrapChanges — mähkimine', () => {
  it('mähib valiku', () => {
    expect(lulita('ab ⟦cd⟧ ef')).toBe('ab <i>cd</i> ef');
  });

  it('servade tühikud jäävad välja', () => {
    expect(lulita('ab⟦ cd ⟧ef')).toBe('ab <i>cd</i> ef');
  });

  it('mitu rida: iga rida eraldi, tühi rida vahele', () => {
    expect(lulita('⟦ab\n\ncd⟧')).toBe('<i>ab</i>\n\n<i>cd</i>');
  });

  it('stiilitäg läheb struktuuritägi (m) SISSE', () => {
    expect(lulita('⟦<m>ab</m>⟧\nx')).toBe('<m><i>ab</i></m>\nx');
    expect(lulita('⟦<m>ab</m>⟧\nx', 'b')).toBe('<m><b>ab</b></m>\nx');
  });

  it('sisemised sama tägi paarid ühendatakse', () => {
    expect(lulita('⟦a <i>b</i> c⟧')).toBe('<i>a b c</i>');
  });

  it('paari seest algav ja väljapoole ulatuv valik laiendab paari', () => {
    expect(lulita('<i>a⟦b</i> c⟧')).toBe('<i>ab c</i>');
  });
});

describe('selectionWrapChanges — lahtipakkimine', () => {
  it('valik koos tägidega eemaldab paari', () => {
    expect(lulita('x ⟦<i>ab</i>⟧ y')).toBe('x ab y');
  });

  it('valik = paari sisu eemaldab paari', () => {
    expect(lulita('x <i>⟦ab⟧</i> y')).toBe('x ab y');
  });

  it('mitu rida: iga rea paar eemaldatakse', () => {
    expect(lulita('<i>⟦ab</i>\n<i>cd⟧</i>')).toBe('ab\ncd');
  });

  it('esimene rida otsustab: tägita rida jääb puutumata', () => {
    expect(lulita('<i>⟦ab</i>\ncd⟧')).toBe('ab\ncd');
  });

  it('marginaalias: valik = rea sisu eemaldab kursiivi, <m> jääb', () => {
    expect(lulita('<m><i>⟦dium lectio⟧</i></m>\nx')).toBe('<m>dium lectio</m>\nx');
  });

  it('valitud <m><i>…</i></m> rida eemaldab kursiivi, ei jäta orbu', () => {
    // Enne: otsus ei hüpanud <m> sisse → „mähkimine" → `<m><i>ab</m>`
    expect(lulita('⟦<m><i>ab</i></m>⟧\nx')).toBe('<m>ab</m>\nx');
    expect(lulita('⟦<m><i>ab</i></m>\n<m><i>cd</i></m>⟧\nx')).toBe('<m>ab</m>\n<m>cd</m>\nx');
  });
});

describe('selectionWrapChanges — paari poolitamine', () => {
  it('sõna paari lõpus', () => {
    expect(lulita('<i>dium ⟦lectio⟧</i>')).toBe('<i>dium </i>lectio');
  });

  it('sõna paari alguses', () => {
    expect(lulita('<i>⟦dium⟧ lectio</i>')).toBe('dium<i> lectio</i>');
  });

  it('sõna paari keskel', () => {
    expect(lulita('x <i>a ⟦b⟧ c</i> y')).toBe('x <i>a </i>b<i> c</i> y');
  });

  it('ainult tühikuks jääv pool ei jäta tühja paari', () => {
    expect(lulita('<i> ⟦lectio⟧</i>')).toBe(' lectio');
  });

  it('marginaaliakaardis: üks sõna tavaliseks, <m> jääb välimiseks', () => {
    expect(lulita('<m><i>Exor-</i></m>\n<m><i>dium ⟦lectio⟧</i></m>\nx'))
      .toBe('<m><i>Exor-</i></m>\n<m><i>dium </i>lectio</m>\nx');
  });

  it('teist paari ei poolitata risti', () => {
    // valik <b> sees → lõige nihkub <b> paari servale
    expect(lulita('<i>a <b>⟦b⟧</b> c</i>')).toBe('<i>a </i><b>b</b><i> c</i>');
    expect(lulita('<i>a <b>b ⟦c⟧</b> d</i>')).toBe('<i>a </i><b>b c</b><i> d</i>');
  });

  it('<pb/> ei sega tasakaalu', () => {
    expect(lulita('<i>a<pb/> ⟦b⟧ c</i>')).toBe('<i>a<pb/> </i>b<i> c</i>');
  });

  it('mitu rida: viimane rida poolitub valiku lõpust', () => {
    expect(lulita('<i>⟦ab</i>\n<i>cd⟧ ef</i>')).toBe('ab\ncd<i> ef</i>');
  });

  it('poolitatud tulemust saab uuesti kursiivi panna', () => {
    expect(lulita('<i>dium </i>⟦lectio⟧')).toBe('<i>dium lectio</i>');
  });
});
