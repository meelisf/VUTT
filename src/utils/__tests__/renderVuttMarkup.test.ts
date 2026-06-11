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
