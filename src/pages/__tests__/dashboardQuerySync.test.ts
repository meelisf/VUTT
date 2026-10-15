import { describe, it, expect } from 'vitest';
import { sortAfterQueryChange } from '../dashboardQuerySync';

describe('sortAfterQueryChange', () => {
  it('tühjenenud päring + relevance → year_asc (ka vihje vastuvõtul, tahtlik)', () => {
    expect(sortAfterQueryChange('relevance', '')).toBe('year_asc');
  });
  it('tekst jääb → sort ei muutu', () => {
    expect(sortAfterQueryChange('relevance', 'constitu')).toBe('relevance');
  });
  it('muu sort ei muutu ka tühjenemisel', () => {
    expect(sortAfterQueryChange('az', '')).toBe('az');
  });
});

import { filterUrlKey, createUrlEchoGuard } from '../dashboardQuerySync';

const p = (s: string) => new URLSearchParams(s);

describe('filterUrlKey', () => {
  it('sõltub ainult filtriparameetritest (mitte page/collection)', () => {
    expect(filterUrlKey(p('q=a&genre=Q1&page=3&collection=c'))).toBe(filterUrlKey(p('collection=x&genre=Q1&q=a')));
  });
  it('iga filtriparameeter muudab võtit', () => {
    const base = filterUrlKey(p('q=a'));
    for (const extra of ['ys=1', 'ye=1', 'sort=az', 'tags=Q1', 'genre=Q1', 'type=Q1', 'langs=lat', 'status=Valmis']) {
      expect(filterUrlKey(p(`q=a&${extra}`))).not.toBe(base);
    }
  });
});

describe('createUrlEchoGuard', () => {
  it('oma kirjutuse kaja tuntakse ära ÜKS kord (trükkimise võidujooks)', () => {
    const g = createUrlEchoGuard();
    g.wrote(p('q=põhi&genre=Q1'));
    // kasutaja on vahepeal trükkinud „põhik" — kaja „põhi" ei tohi seda üle kirjutada
    expect(g.isEcho(p('q=põhi&genre=Q1&collection=c'))).toBe(true);
    // sama URL hiljem (nt tagasinupp) EI OLE enam kaja
    expect(g.isEcho(p('q=põhi&genre=Q1'))).toBe(false);
  });
  it('võõras URL-i muutus ei ole kaja', () => {
    const g = createUrlEchoGuard();
    g.wrote(p('q=põhi&genre=Q1'));
    expect(g.isEcho(p('q=põhi'))).toBe(false);          // nt „Tühjenda" või tagasinupp
  });
  it('ilma kirjutuseta pole kaja', () => {
    expect(createUrlEchoGuard().isEcho(p('q=a'))).toBe(false);
  });
});
