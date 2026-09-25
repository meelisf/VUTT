import { describe, it, expect } from 'vitest';
import { applyEnrichmentToDraft, recordToDraft } from '../helpers';
import type { ProsopoRecord } from '../../../types';

// Wikidata Juliuse märgend jõuab vormi kalendrivalikusse koos kuupäevaga (2026-09-25).

const tühi = recordToDraft({
  id: 'vutt:Ptest03', name: { label: 'Kristiina', aliases: [] }, identifiers: [],
} as unknown as ProsopoRecord);

describe('kalender rikastusest', () => {
  it('tuleb koos kuupäevaga', () => {
    const d = applyEnrichmentToDraft(
      { 'death.date': '1689-04-09', 'death.precision': 'day', 'death.calendar': 'julian' }, tühi);
    expect([d.death.year, d.death.day, d.death.calendar]).toEqual(['1689', '9', 'julian']);
  });

  it('allika vaikimisel jääb käsitsi märgitud kalender', () => {
    const d = applyEnrichmentToDraft(
      { 'death.date': '1689-04-19', 'death.precision': 'day' },
      { ...tühi, death: { ...tühi.death, calendar: 'gregorian' } });
    expect(d.death.calendar).toBe('gregorian');
  });

  it('ilma kuupäevata täidab ainult tühja kalendri', () => {
    const olemas = { ...tühi, death: { ...tühi.death, year: '1689', month: '4', day: '9' } };
    expect(applyEnrichmentToDraft({ 'death.calendar': 'julian' }, olemas).death.calendar).toBe('julian');
    const märgitud = { ...olemas, death: { ...olemas.death, calendar: 'gregorian' as const } };
    expect(applyEnrichmentToDraft({ 'death.calendar': 'julian' }, märgitud).death.calendar).toBe('gregorian');
  });
});
