// <add> on VUTT-i paaristäg (ADR 0067): orvuks jäänud täg leitakse nagu teistelgi.
import { describe, it, expect } from 'vitest';
import { findOrphanTags } from '../VuttMarkupExtension';

describe('findOrphanTags — <add>', () => {
  it('paaris <add> ei ole orb', () => {
    expect(findOrphanTags('daß <add>mir</add> bedeutende')).toEqual([]);
  });

  it('orv avav ja sulgev <add> leitakse', () => {
    expect(findOrphanTags('daß <add>mir bedeutende')).toEqual([{ from: 4, to: 9 }]);
    expect(findOrphanTags('daß mir</add> bedeutende')).toEqual([{ from: 7, to: 13 }]);
  });
});
