import { describe, it, expect } from 'vitest';
import { escapeHtml, sanitizeHighlight, HIGHLIGHT_PRE_TAG, HIGHLIGHT_POST_TAG } from '../sanitizeHtml';

describe('escapeHtml', () => {
  it('escape & < >', () => {
    expect(escapeHtml('a & b < c > d')).toBe('a &amp; b &lt; c &gt; d');
  });
  it('escape kogu skripti-tägi', () => {
    expect(escapeHtml('<script>alert(1)</script>')).toBe('&lt;script&gt;alert(1)&lt;/script&gt;');
  });
});

describe('sanitizeHighlight', () => {
  it('säilitab Meilisearchi highlight-tägid', () => {
    const input = `enne ${HIGHLIGHT_PRE_TAG}sõna${HIGHLIGHT_POST_TAG} pärast`;
    const out = sanitizeHighlight(input);
    expect(out).toBe(`enne ${HIGHLIGHT_PRE_TAG}sõna${HIGHLIGHT_POST_TAG} pärast`);
  });

  it('escape stored XSS — img onerror', () => {
    const out = sanitizeHighlight('hea <img src=x onerror=alert(1)>');
    expect(out).toBe('hea &lt;img src=x onerror=alert(1)&gt;');
    expect(out).not.toContain('<img');
  });

  it('escape script-tägi kommentaaris', () => {
    const out = sanitizeHighlight('<script>alert(document.cookie)</script>');
    expect(out).not.toContain('<script');
    expect(out).toContain('&lt;script&gt;');
  });

  it('ei lase võltsida atribuudiga em-tägi', () => {
    // ründaja kirjutab em onmouseover — ei tohi taastuda käivituvaks tägiks
    const out = sanitizeHighlight('<em onmouseover=alert(1)>x</em>');
    expect(out).not.toContain('onmouseover=alert(1)>'); // mitte aktiivse tägina
    expect(out).toContain('&lt;em onmouseover');
  });

  it('highlight + XSS koos — ainult highlight taastub', () => {
    const input = `${HIGHLIGHT_PRE_TAG}match${HIGHLIGHT_POST_TAG} <img src=x onerror=alert(1)>`;
    const out = sanitizeHighlight(input);
    expect(out).toContain(HIGHLIGHT_PRE_TAG);
    expect(out).toContain('&lt;img');
    expect(out).not.toContain('<img');
  });

  it('allowBr asendab reavahetused', () => {
    expect(sanitizeHighlight('rida1\nrida2', { allowBr: true })).toBe('rida1<br>rida2');
  });

  it('ilma allowBr jätab reavahetuse alles', () => {
    expect(sanitizeHighlight('rida1\nrida2')).toBe('rida1\nrida2');
  });
});
