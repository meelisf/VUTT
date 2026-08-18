import { describe, it, expect } from 'vitest';
import { mergedRedirectTarget } from '../mergedRedirect';

// Vt issue #240: tombstone'i URL peab viima päris kirjele, muidu tekib segadus —
// kasutaja näeb aadressiribal ühte ID-d ja lehel teise isiku andmeid.
describe('mergedRedirectTarget', () => {
  it('annab sihtmärgi, kui laetud kaardi ID erineb marsruudi omast', () => {
    expect(mergedRedirectTarget('vutt:Pdtoaxn', 'vutt:Pezmxsj')).toBe('vutt:Pezmxsj');
  });

  it('ei suuna, kui ID-d klapivad', () => {
    expect(mergedRedirectTarget('vutt:Pezmxsj', 'vutt:Pezmxsj')).toBeNull();
  });

  it('ei suuna, kui laetud kaardil puudub ID', () => {
    expect(mergedRedirectTarget('vutt:Pdtoaxn', undefined)).toBeNull();
    expect(mergedRedirectTarget('vutt:Pdtoaxn', '')).toBeNull();
  });

  it('talub URL-kodeeritud koolonit marsruudil', () => {
    expect(mergedRedirectTarget('vutt%3APdtoaxn', 'vutt:Pdtoaxn')).toBeNull();
  });
});
