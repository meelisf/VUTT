/** Registri salvestuse veakood → kasutajale arusaadav lause (mitte paljas `invalid_notes`). */
import { describe, expect, it } from 'vitest';
import type { TFunction } from 'i18next';
import et from '../../../locales/et/prosopography.json';
import en from '../../../locales/en/prosopography.json';
import { ApiError } from '../../../services/apiClient';
import { REGISTRY_ERROR_CODES, REGISTRY_NOTES_MAX, registryErrorMessage } from '../registryErrors';

// Lihtne t: loeb eestikeelse sõne ja asendab {{muutujad}}.
const t = ((key: string, opts: Record<string, unknown> = {}) => {
  const code = key.replace('prosopography:registryErrors.', '');
  const text = (et.registryErrors as Record<string, string>)[code] ?? key;
  return text.replace(/\{\{(\w+)\}\}/g, (_, k) => String(opts[k]));
}) as unknown as TFunction;

describe('registryErrorMessage', () => {
  it('liiga pikk märkus: piir ja praegune pikkus lauses', () => {
    const msg = registryErrorMessage(new ApiError('invalid_notes', 400, {}), t, 'a'.repeat(2400));
    expect(msg).toContain(String(REGISTRY_NOTES_MAX));
    expect(msg).toContain('2400');
    expect(msg).not.toContain('invalid_notes');
  });

  it('tundmatu serverikood saab üldlause koos koodiga', () => {
    expect(registryErrorMessage(new ApiError('registry_unreadable', 503, {}), t))
      .toBe('Salvestamine ebaõnnestus (registry_unreadable).');
  });

  it('mitte-koodiga sõnum (võrguviga) jääb muutmata', () => {
    expect(registryErrorMessage(new Error('Failed to fetch'), t)).toBe('Failed to fetch');
  });

  it('igal koodil on sõne mõlemas keeles', () => {
    for (const code of [...REGISTRY_ERROR_CODES, 'generic']) {
      expect((et.registryErrors as Record<string, string>)[code], code).toBeTruthy();
      expect((en.registryErrors as Record<string, string>)[code], code).toBeTruthy();
    }
  });
});
