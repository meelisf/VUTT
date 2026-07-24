import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Lukustab `MarkdownView`-i turvainvariandi (vt CLAUDE.md, #189).
 *
 * `MarkdownView` renderdab kasutaja kirjutatud vabateksti (prosopograafia
 * Märkmed / Elulugu, lehekülje kommentaarid). Turvalisus tugineb sellele, et
 * toores HTML jääb escape'ituks — see kehtib ainult seni, kuni `rehype-raw`
 * pole kasutusel. Üks import teeks kogu allow-listi mõttetuks ja avaks XSS-i.
 *
 * Sõltuvus on `package.json`-ist eemaldatud, aga see test hoiab invariandi
 * kehtivana ka siis, kui keegi paketi hiljem tagasi lisab.
 */
const repoRoot = resolve(__dirname, '../../..');
const read = (p: string) => readFileSync(resolve(repoRoot, p), 'utf8');

describe('MarkdownView turvainvariant', () => {
  it('ei impordi rehype-raw-d', () => {
    const source = read('src/components/MarkdownView.tsx');
    expect(source).not.toMatch(/from\s+['"]rehype-raw['"]/);
    expect(source).not.toMatch(/\brehypeRaw\b/);
  });

  it('ei kasuta rehypePlugins propi', () => {
    // Ka muu rehype-plugin võib tooret HTML-i läbi lasta — kui seda on
    // päriselt vaja, tuleb see teadlik otsus siin üle vaadata.
    const source = read('src/components/MarkdownView.tsx');
    expect(source).not.toMatch(/rehypePlugins/);
  });

  it('rehype-raw ei ole projekti sõltuvustes', () => {
    const pkg = JSON.parse(read('package.json'));
    const deps = { ...pkg.dependencies, ...pkg.devDependencies };
    expect(deps['rehype-raw']).toBeUndefined();
  });

  it('hoiab allow-listi ja unwrapDisallowed kasutusel', () => {
    const source = read('src/components/MarkdownView.tsx');
    expect(source).toMatch(/allowedElements/);
    expect(source).toMatch(/unwrapDisallowed/);
  });
});
