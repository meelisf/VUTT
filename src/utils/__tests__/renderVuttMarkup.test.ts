import { describe, it, expect } from 'vitest';
import { renderVuttMarkup } from '../renderVuttMarkup';

describe('renderVuttMarkup — VUTT-tägide renderdamine', () => {
  it('bold ja italic', () => {
    expect(renderVuttMarkup('<b>paks</b>')).toBe('<strong>paks</strong>');
    expect(renderVuttMarkup('<i>kald</i>')).toBe('<em>kald</em>');
  });

  it('footnote superscriptina', () => {
    expect(renderVuttMarkup('tekst<fn>1</fn>')).toContain('<sup');
    expect(renderVuttMarkup('tekst<fn>1</fn>')).toContain('1</sup>');
  });

  it('pb leheküljevahetus', () => {
    expect(renderVuttMarkup('a<pb/>b')).toContain('── lk ──');
  });

  it('cs ja m', () => {
    expect(renderVuttMarkup('<cs>x</cs>')).toContain('italic tracking-wide');
    expect(renderVuttMarkup('<m>x</m>')).toContain('border-l-2');
  });

  it('renderdab <m> ploki kaardina (block, väiksem kiri, ilma sundkursiivita)', () => {
    const html = renderVuttMarkup('põhi\n<m>Apoc. 12.</m>\ntekst');
    expect(html).toContain('class="block');
    expect(html).toContain('Apoc. 12.');
    expect(html).not.toContain('italic">Apoc'); // sisu EI ole sundkursiivis
  });

  it('<m> sisemine märgendus renderdub tavaliselt', () => {
    const html = renderVuttMarkup('<m>Vide <i>Picrium</i></m>');
    expect(html).toContain('<em>Picrium</em>');
  });
});

describe('renderVuttMarkup — annotatsioonid (<annN>)', () => {
  it('renderdab <ann1> sisu highlight-märgendina, tägid peidetud', () => {
    const out = renderVuttMarkup('<ann1>tekst</ann1>');
    expect(out).not.toContain('ann1');
    expect(out).not.toContain('&lt;ann');
    expect(out).toContain('tekst');
    expect(out).toMatch(/<mark[^>]*>tekst<\/mark>/);
  });

  it('annotatsioon marginaalia sees (overlay stsenaarium)', () => {
    const out = renderVuttMarkup('<m>Vide <ann2>Picrium</ann2></m>');
    expect(out).not.toContain('ann2');
    expect(out).toContain('Picrium');
    expect(out).toMatch(/<mark[^>]*>Picrium<\/mark>/);
  });

  it('mitmekohaline ID ja mitu annotatsiooni', () => {
    const out = renderVuttMarkup('<ann12>a</ann12> ja <ann3>b</ann3>');
    expect(out).not.toContain('ann12');
    expect(out).not.toContain('ann3');
    expect(out).toContain('a');
    expect(out).toContain('b');
  });

  it('orv (paarita) ann-täg eemaldatakse, sisu säilib', () => {
    const out = renderVuttMarkup('enne <ann5>sisu järel');
    expect(out).not.toContain('ann5');
    expect(out).toContain('enne sisu järel');
  });

  it('valepaar (ID-d ei klapi) ei renderdu markina, tägid eemaldatakse', () => {
    const out = renderVuttMarkup('<ann1>tekst</ann2>');
    expect(out).not.toContain('ann1');
    expect(out).not.toContain('ann2');
    expect(out).toContain('tekst');
  });

  it('ann-tägi ei saa kuritarvitada atribuutidega (XSS)', () => {
    const out = renderVuttMarkup('<ann1 onclick="alert(1)">x</ann1>');
    expect(out).not.toContain('onclick');
  });
});

describe('renderVuttMarkup — XSS kaitse (Leid A)', () => {
  it('span onclick — ei teki aktiivset elementi (< on escape\'itud)', () => {
    const out = renderVuttMarkup('<span onclick="alert(1)">kliki</span>');
    // Turvaomadus: <span ei tohi olla aktiivse tägina (peab olema &lt;span).
    // onclick võib jääda inertse tekstina — see ei käivitu, sest elementi ei loodud.
    expect(out).not.toMatch(/<span/);
    expect(out).toContain('&lt;span');
  });

  it('img onerror escape', () => {
    const out = renderVuttMarkup('<img src=x onerror=alert(1)>');
    expect(out).not.toContain('<img');
    expect(out).toContain('&lt;img');
  });

  it('script-tägi escape', () => {
    const out = renderVuttMarkup('<script>alert(1)</script>');
    expect(out).not.toContain('<script');
    expect(out).toContain('&lt;script');
  });

  it('VUTT-nimega tägi atribuudiga — eemaldatakse (nt <b onclick>)', () => {
    // <b onclick=...> ei vasta paaris-replace'ile (<b>...</b>) ja eemaldatakse strip-regexiga
    const out = renderVuttMarkup('<b onclick="alert(1)">x</b>');
    expect(out).not.toContain('onclick');
  });

  it('legitiimne tekst < märgiga säilib escape\'ituna', () => {
    const out = renderVuttMarkup('2 < 3 ja 5 > 4');
    expect(out).toContain('&lt;');
  });
});
