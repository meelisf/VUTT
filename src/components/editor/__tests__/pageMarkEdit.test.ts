// Lehe tähistuse sisestus (ADR 0070, spekk 1 §3): rida/valik, olemasolev paar,
// keeldumised, vorminduse poolitus — tähistus ei haara kunagi valimata põhiteksti.
import { describe, it, expect } from 'vitest';
import { pageMarkEdit, type PageMarkEditResult } from '../pageMarkEdit';
import type { PageMarkKind } from '../../../markup/vuttTags';

// ⟦ … ⟧ = valik, ‸ = kursor
function run(marked: string, kind: PageMarkKind, hidden: { from: number; to: number }[] = []) {
  let from: number;
  let to: number;
  let doc: string;
  if (marked.includes('‸')) {
    from = to = marked.indexOf('‸');
    doc = marked.replace('‸', '');
  } else {
    from = marked.indexOf('⟦');
    to = marked.indexOf('⟧') - 1;
    doc = marked.replace('⟦', '').replace('⟧', '');
  }
  const r: PageMarkEditResult = pageMarkEdit(doc, from, to, kind, hidden);
  if (!r.ok) return { refused: r.reason };
  let out = doc;
  for (const c of [...r.changes].sort((a, b) => b.from - a.from)) out = out.slice(0, c.from) + c.insert + out.slice(c.to);
  return { doc: out, cursor: r.cursor };
}

describe('pageMarkEdit — rida ja valik', () => {
  it('valikuta mähib kursori rea', () => {
    expect(run('a\nA i‸ij\nb', 'sig').doc).toBe('a\n<sig>A iij</sig>\nb');
  });
  it('rea äärmised tühikud jäävad välja', () => {
    expect(run('  A‸ ij  ', 'sig').doc).toBe('  <sig>A ij</sig>  ');
  });
  it('valik mähitakse', () => {
    expect(run('Hom. ⟦1903⟧', 'fw').doc).toBe('Hom. <fw>1903</fw>');
  });
  it('valiku servatühikud jäävad välja', () => {
    expect(run('Hom.⟦ 1903 ⟧', 'fw').doc).toBe('Hom. <fw>1903</fw> ');
  });
  it('tühi rida: tühi paar, kursor sisse', () => {
    expect(run('a\n‸\nb', 'fw')).toEqual({ doc: 'a\n<fw></fw>\nb', cursor: 6 });
  });
  it('kursor avatud <m> sees: ainult ploki sisu', () => {
    expect(run('<m>fol‸. 3</m>\npõhi', 'fw').doc).toBe('<m><fw>fol. 3</fw></m>\npõhi');
  });
});

describe('pageMarkEdit — olemasolev tähistus', () => {
  it('sama liik eemaldab terve paari', () => {
    expect(run('x\n<sig>A‸ ij</sig>', 'sig').doc).toBe('x\nA ij');
  });
  it('teine liik vahetab', () => {
    expect(run('x\n<sig>A‸ ij</sig>', 'catch').doc).toBe('x\n<catch>A ij</catch>');
  });
  it('mitu tähistust → keeldumine', () => {
    expect(run('⟦<sig>A</sig> <catch>b</catch>⟧', 'fw')).toEqual({ refused: 'multiple' });
  });
});

describe('pageMarkEdit — keeldumised', () => {
  it('<pb/> vahemikus', () => {
    expect(run('⟦a<pb/>b⟧', 'fw')).toEqual({ refused: 'pageBreak' });
  });
  it('ületab <m> piiri', () => {
    expect(run('⟦a <m>b⟧ c</m>', 'fw')).toEqual({ refused: 'marginalia' });
  });
  it('peidetud marginaaliaplokk vahemikus', () => {
    expect(run('⟦ab cd⟧', 'fw', [{ from: 1, to: 3 }])).toEqual({ refused: 'marginalia' });
  });
  it('ristub annotatsiooniga', () => {
    expect(run('<ann1>a⟦b</ann1>c⟧', 'fw')).toEqual({ refused: 'tagBoundary' });
  });
  it('keeldub, kui serv on tägi sees', () => {
    // valik algab <i> tägi keskelt (Review Focus 3)
    expect(pageMarkEdit('<i>ab</i>', 1, 5, 'fw', [])).toEqual({ ok: false, reason: 'tagBoundary' });
  });
});

describe('pageMarkEdit — vormindus: nähtav ulatus säilib', () => {
  it('valik kursiivi sees → tähistus kursiivi sisse, põhitekst puutumata', () => {
    expect(run('<i>põhitekst ⟦12⟧</i>', 'fw').doc).toBe('<i>põhitekst <fw>12</fw></i>');
  });
  it('lõikab kursiivi algust → kursiiv poolitatakse', () => {
    expect(run('<i>a⟦b</i>cd⟧e', 'fw').doc).toBe('<i>a</i><fw><i>b</i>cd</fw>e');
  });
  it('lõikab kursiivi lõppu → kursiiv poolitatakse', () => {
    expect(run('⟦a<i>b⟧c</i>', 'fw').doc).toBe('<fw>a<i>b</i></fw><i>c</i>');
  });
  it('terve kursiivirida mähitakse ilma poolituseta', () => {
    expect(run('<i>Vorr‸ede</i>\nhabe', 'rh').doc).toBe('<rh><i>Vorrede</i></rh>\nhabe');
  });
});
