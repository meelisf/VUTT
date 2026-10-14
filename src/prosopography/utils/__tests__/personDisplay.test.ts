import { describe, expect, it } from 'vitest';
import { personOrigin, personStatusText } from '../personDisplay';
import type { ProsopoIndexEntry } from '../../types';

// Kaart ja loendirida (#587) näitavad sama päritolu- ja seisuseteksti ühest allikast.
const isik = (o: Partial<ProsopoIndexEntry>): ProsopoIndexEntry => ({
  origin_place: null, origin_place_labels: null, origin_parent: null,
  origin_group: null, origin_group_labels: null, status_ids: [], status_labels: [],
  ...o,
} as ProsopoIndexEntry);

describe('personOrigin', () => {
  it('ajalooline nimi + tänapäevane + ülemüksus', () => {
    const p = isik({
      origin_place: 'Reval',
      origin_place_labels: { et: 'Tallinn' },
      origin_parent: { key: 'estland', labels: { et: 'Eestimaa' } } as ProsopoIndexEntry['origin_parent'],
    });
    expect(personOrigin(p, 'et')).toEqual({ text: 'Reval (Tallinn) · Eestimaa', hasPlace: true });
  });

  it('kohata langeb päritologrupile ja seda kaardil ei näidata', () => {
    const p = isik({ origin_group: 'livland', origin_group_labels: { et: 'Liivimaa', en: 'Livonia' } });
    expect(personOrigin(p, 'en')).toEqual({ text: 'Livonia', hasPlace: false });
  });

  it('päritoluta isik', () => {
    expect(personOrigin(isik({}), 'et')).toEqual({ text: null, hasPlace: false });
  });
});

describe('personStatusText', () => {
  const vocab = [{ id: 'Q1', label: { et: 'aadel', en: 'nobility' } }] as never;

  it('sõnavara aktiivses keeles, tundmatu id langeb eestikeelsele sildile', () => {
    const p = isik({ status_ids: ['Q1', 'Q2'], status_labels: ['aadel', 'kaupmees'] });
    expect(personStatusText(p, vocab, true)).toBe('nobility, kaupmees');
  });
});
