/**
 * Vearaport EI TOHI kanda volitusi (#133 ülevaatus).
 *
 * `/set-password?token=<uuid>` loeb tokeni päringustringist (`SetPassword.tsx`).
 * Kui sellel lehel juhtub ükskõik milline JS-viga, kirjutaks toores
 * `window.location.search` kehtiva kutse- või paroolivahetuse tokeni
 * `state/client_errors.json`-i, kust admin-paneel selle välja näitab.
 *
 * Reegel on KAHEOSALINE, sest kumbki pool üksi lekiks:
 *  - võtmenimi (`token`, `reset`, …) — katab lühikesi väärtusi
 *  - väärtuse KUJU (UUID, pikk hex) — katab tulevasi võtmenimesid, mida
 *    keegi ei mäletanud nimekirja lisada
 */
import { describe, it, expect } from 'vitest';
import { scrubUrl, scrubText, REDACTED } from '../scrubSensitive';

describe('scrubUrl', () => {
  it('eemaldab parooli-tokeni päringustringist', () => {
    const out = scrubUrl('/set-password?token=3f1a9c22-77bd-4e1a-9b3e-5c1d2e3f4a5b');
    expect(out).not.toContain('3f1a9c22');
    expect(out).toContain('/set-password');
    expect(out).toContain(REDACTED);
  });

  it('katab ka reset- ja invite-vormi', () => {
    expect(scrubUrl('/set-password?token=abc&reset=1')).not.toContain('abc');
    expect(scrubUrl('/invite?invite=xyz123')).not.toContain('xyz123');
  });

  it('säilitab diagnostiliselt kasuliku päringu', () => {
    // Just see string ütles 2026-09-15, MIS lehel kaardiviga juhtus.
    const out = scrubUrl('/persons?view=map&related_to=vutt:Pj1blexq');
    expect(out).toContain('view=map');
    expect(out).toContain('related_to=vutt:Pj1blexq');
  });

  it('eemaldab tundmatu võtmenimega UUID-i', () => {
    // Homme lisatud `?k=<uuid>` ei ole üheski nimekirjas — kuju päästab.
    const out = scrubUrl('/x?k=3f1a9c22-77bd-4e1a-9b3e-5c1d2e3f4a5b');
    expect(out).not.toContain('3f1a9c22');
    expect(out).toContain(REDACTED);
  });

  it('eemaldab pika juhusliku väärtuse', () => {
    const out = scrubUrl('/x?s=' + 'a1b2c3d4e5f6'.repeat(4));
    expect(out).not.toContain('a1b2c3d4e5f6a1b2');
  });

  it('jätab tee alles ka ilma päringuta', () => {
    expect(scrubUrl('/persons')).toBe('/persons');
  });

  it('ei vise katkise sisendi peale', () => {
    expect(() => scrubUrl('')).not.toThrow();
    expect(() => scrubUrl('%%%')).not.toThrow();
  });
});

describe('scrubText', () => {
  it('eemaldab tokeni veateatest ja stackist', () => {
    const out = scrubText('Failed at /set-password?token=3f1a9c22-77bd-4e1a-9b3e-5c1d2e3f4a5b');
    expect(out).not.toContain('3f1a9c22');
  });

  it('jätab tavalise teate puutumata', () => {
    const teade = "can't access property \"setFeatureState\", this.style is undefined";
    expect(scrubText(teade)).toBe(teade);
  });

  it('talub null-i', () => {
    expect(scrubText(undefined)).toBeUndefined();
  });
});
