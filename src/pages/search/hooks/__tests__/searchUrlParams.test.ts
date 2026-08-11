import { describe, expect, it } from 'vitest';
import { parseListParam } from '../useSearchUrlParams';

describe('parseListParam', () => {
  it('poolitab komadega eraldatud väärtused', () => {
    expect(parseListParam('grc,lat')).toEqual(['grc', 'lat']);
  });

  it('annab ühe elemendiga massiivi ühe väärtuse korral', () => {
    expect(parseListParam('grc')).toEqual(['grc']);
  });

  it('annab tühja massiivi, kui parameetrit ei ole', () => {
    expect(parseListParam(null)).toEqual([]);
  });

  it('annab tühja massiivi tühja stringi korral', () => {
    expect(parseListParam('')).toEqual([]);
  });

  it('viskab tühjad vahed välja', () => {
    // ",grc,,lat," tekib, kui kasutaja on URL-i käsitsi näppinud
    expect(parseListParam(',grc,,lat,')).toEqual(['grc', 'lat']);
  });
});
