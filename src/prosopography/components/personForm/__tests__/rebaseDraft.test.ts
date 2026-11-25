import { describe, it, expect } from 'vitest';
import { rebaseDraft } from '../helpers';
import { emptyDraft } from '../types';

/**
 * 409 isikuvormis (2026-11-25, vutt:P22mmjb): valikust loodud isiku taustarikastus
 * salvestas kaardi 9 s pärast loomist, kasutaja salvestus sai 409 ja teade „laadi
 * leht uuesti" viskas kõik vormi muudatused minema. `rebaseDraft` paneb kasutaja
 * muudatused värske kaardi peale väljade kaupa (kolmesuunaline liitmine).
 */
describe('rebaseDraft', () => {
  const base = { ...emptyDraft(), name_label: 'Justus Samuel Scharschmidt' };

  it('kasutaja muudetud väli jääb, serveri täidetud puutumata väli tuleb kaasa', () => {
    const mine = { ...base, notes: 'Minu märkus', floruit_from: '1690' };
    const theirs = { ...base, gnd_id: '1074129784', birth: { ...base.birth, year: '1664' } };
    const { draft, collisions } = rebaseDraft(base, mine, theirs);
    expect(draft.notes).toBe('Minu märkus');
    expect(draft.floruit_from).toBe('1690');
    expect(draft.gnd_id).toBe('1074129784');
    expect(draft.birth.year).toBe('1664');
    expect(collisions).toEqual([]);
  });

  it('mõlemad muutsid sama välja eri väärtuseks → kasutaja oma jääb, väli on kokkupõrge', () => {
    const mine = { ...base, birth: { ...base.birth, year: '1665' } };
    const theirs = { ...base, birth: { ...base.birth, year: '1664' } };
    const { draft, collisions } = rebaseDraft(base, mine, theirs);
    expect(draft.birth.year).toBe('1665');
    expect(collisions).toEqual(['birth']);
  });

  it('mõlemad jõudsid sama väärtuseni → ei ole kokkupõrge', () => {
    const mine = { ...base, gender: 'M' as const };
    const theirs = { ...base, gender: 'M' as const };
    expect(rebaseDraft(base, mine, theirs).collisions).toEqual([]);
  });

  it('massiivid võrreldakse sisu järgi (nimekiri tervikuna)', () => {
    const mine = { ...base, statuses: ['Q1'] };
    const theirs = { ...base, statuses: [] };
    expect(rebaseDraft(base, mine, theirs).draft.statuses).toEqual(['Q1']);
  });
});
