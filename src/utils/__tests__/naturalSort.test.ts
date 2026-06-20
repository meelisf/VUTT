import { describe, it, expect } from 'vitest';
import { naturalCompare } from '../naturalSort';

const sortNames = (xs: string[]) => [...xs].sort(naturalCompare);

describe('naturalCompare (peab Python natural_sort_key-ga kokku langema)', () => {
  it('numbriline järjestus, mitte leksikaalne', () => {
    expect(sortNames(['scan_10.jpg', 'scan_2.jpg', 'scan_1.jpg']))
      .toEqual(['scan_1.jpg', 'scan_2.jpg', 'scan_10.jpg']);
  });
  it('juhtnumber-token (2.jpg → tühi esimene token)', () => {
    expect(sortNames(['10.jpg', '2.jpg', '1.jpg']))
      .toEqual(['1.jpg', '2.jpg', '10.jpg']);
  });
  it('case-insensitive grupeerimine', () => {
    expect(sortNames(['Scan_1.jpg', 'scan_0.jpg']))
      .toEqual(['scan_0.jpg', 'Scan_1.jpg']);
  });
  it('tähed ja numbrid segamini', () => {
    expect(sortNames(['a2b', 'a10b', 'a1b'])).toEqual(['a1b', 'a2b', 'a10b']);
  });
  it('idempotentne juhtnullidega', () => {
    const out = sortNames(['scan_02.jpg', 'scan_2.jpg']);
    expect([...out].sort(naturalCompare)).toEqual(out);
  });
});
