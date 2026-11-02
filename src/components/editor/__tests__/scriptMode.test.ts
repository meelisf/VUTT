// src/components/editor/__tests__/scriptMode.test.ts
import { describe, it, expect } from 'vitest';
import { EditorState } from '@codemirror/state';
import {
  minorityRanges, pageScript, recomputeScriptMode, scriptModeExtension, scriptModeField, toggleScriptMode,
} from '../scriptMode';
import { pageSwapAnnotation } from '../editorAnnotations';

const slices = (text: string, mode: 'antiqua' | 'fraktur') =>
  minorityRanges(text, mode).map(r => text.slice(r.from, r.to));

describe('pageScript — lehe enamuskiri', () => {
  it('ladinakeelne leht ilma <f>-ita on antiikva, silti ei ole', () => {
    expect(pageScript('Disputatio de anima')).toEqual({ mode: 'antiqua', hasF: false });
  });

  it('fraktuurleht antiikvasõnaga on fraktuur', () => {
    expect(pageScript('<f>sich bey den </f>exercitiis<f> finden laſſen</f>'))
      .toEqual({ mode: 'fraktur', hasF: true });
  });

  it('antiikvaleht üksiku fraktuurisõnaga on antiikva', () => {
    expect(pageScript('Thesis prima <f>Gott</f> secunda tertia').mode).toBe('antiqua');
  });

  it('kreeka ja numbrid ei loe', () => {
    expect(pageScript('<f>ab</f> λόγος λόγος 1644 1645').mode).toBe('fraktur');
  });
});

describe('minorityRanges', () => {
  it('antiikvarežiim: <f>-paaride sisu', () => {
    expect(slices('Thesis <f>Gott</f> prima', 'antiqua')).toEqual(['Gott']);
  });

  it('fraktuurirežiim: ladina jooksud väljaspool <f>-i', () => {
    expect(slices('<f>sich bey den </f>exercitiis<f> finden</f>', 'fraktur')).toEqual(['exercitiis']);
  });

  it('fraktuurirežiim: jooks hõlmab tühiku ja tägi, katkeb reavahetusel', () => {
    expect(slices('<f>als </f><i>exercitiis</i> Academicis\nproces<f> in</f>', 'fraktur'))
      .toEqual(['exercitiis</i> Academicis', 'proces']);
  });

  it('fraktuurirežiim: kreeka katkestab ega ole esile tõstetud', () => {
    expect(slices('<f>vom </f>λόγος<f> wort</f>', 'fraktur')).toEqual([]);
  });
});

describe('scriptModeField', () => {
  const mk = (doc: string) => EditorState.create({ doc, extensions: [scriptModeExtension()] });

  it('režiim ei pöördu tavalise muudatusega, pöördub tervikasendusel', () => {
    let s = mk('Thesis prima secunda');
    s = s.update({ changes: { from: 0, to: s.doc.length, insert: '<f>ganz deutsch hier</f> x' } }).state;
    expect(s.field(scriptModeField).mode).toBe('antiqua');
    expect(s.field(scriptModeField).hasF).toBe(true); // silt ilmub esimese <f>-iga
    s = s.update({ annotations: pageSwapAnnotation.of(true) }).state;
    expect(s.field(scriptModeField).mode).toBe('fraktur');
  });

  it('recompute-efekt arvutab uuesti (salvestamine)', () => {
    let s = mk('Thesis');
    s = s.update({ changes: { from: 0, to: s.doc.length, insert: '<f>ganz deutsch</f>' } }).state;
    s = s.update({ effects: recomputeScriptMode.of(null) }).state;
    expect(s.field(scriptModeField).mode).toBe('fraktur');
  });

  it('käsitsi pööramine; järgmine automaatne arvutus kirjutab üle', () => {
    let s = mk('Thesis prima');
    s = s.update({ effects: toggleScriptMode.of(null) }).state;
    expect(s.field(scriptModeField)).toMatchObject({ mode: 'fraktur', manual: true });
    s = s.update({ effects: recomputeScriptMode.of(null) }).state;
    expect(s.field(scriptModeField)).toMatchObject({ mode: 'antiqua', manual: false });
  });
});
