import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ocrErrorKey, ocrErrorText } from '../ocrErrorText';

/**
 * OCR-pakkuja veakoodi → lugeja keeles renderdatav lause (#292).
 *
 * ADR 0033: rakenduses loetav tekst renderdatakse lugeja keeles, lugemise
 * hetkel. Server annab masinloetava koodi (`content_blocked: …`, sama
 * konventsioon mis `request_too_large`), lause koostab siin pool.
 */

function locale(lang: 'et' | 'en'): Record<string, unknown> {
  return JSON.parse(
    readFileSync(resolve(__dirname, `../../locales/${lang}/common.json`), 'utf-8'),
  );
}

function hasKey(obj: Record<string, unknown>, path: string): boolean {
  return path.split('.').reduce<unknown>(
    (acc, osa) => (acc && typeof acc === 'object' ? (acc as Record<string, unknown>)[osa] : undefined),
    obj,
  ) !== undefined;
}

describe('ocrErrorKey', () => {
  it('tunneb sisufiltri keeldumise ära koodiprefiksist', () => {
    expect(ocrErrorKey('content_blocked: Gemini sisufilter keeldus sellest lehest'))
      .toBe('common:errors.ocr.content_blocked');
  });

  it('tundmatu veateate jaoks võtit ei ole', () => {
    // Kutsuja kuvab siis serveri enda sõnumi — see on parem kui üldine
    // „midagi läks valesti", mis kaotaks ainsa diagnostilise jälje.
    expect(ocrErrorKey('HTTP 500: sisemine viga')).toBeNull();
  });

  it('tühja sisendi jaoks võtit ei ole', () => {
    expect(ocrErrorKey(null)).toBeNull();
    expect(ocrErrorKey('')).toBeNull();
  });

  it('kood peab olema PREFIKS, mitte suvaline esinemine sõnumis', () => {
    // Eristav test: `includes`-põhine kood läbiks kõik ülejäänud testid, aga
    // sobitaks ka API vabateksti, kus kood esineb tsitaadina.
    expect(ocrErrorKey('Tundmatu viga (mainis content_blocked logis)')).toBeNull();
  });

  it('tagastatud võti on olemas mõlemas keeles', () => {
    // ADR 0011: `fallbackLng` on väljas — ainult ühte keelde lisatud võti
    // ilmuks teises keeles kasutajale toorel kujul.
    const key = ocrErrorKey('content_blocked: x');
    expect(key).not.toBeNull();
    const path = (key as string).split(':')[1];
    expect(hasKey(locale('et'), path)).toBe(true);
    expect(hasKey(locale('en'), path)).toBe(true);
  });
});

describe('ocrErrorText', () => {
  // Päris tõlkefailist lugev `t` — mock ütleks ainult, et kutsusime teda, mitte
  // seda, et kasutaja näeb päris lauset.
  function tFrom(lang: 'et' | 'en') {
    const pakid = { common: locale(lang) };
    return (key: string): string => {
      const [ns, path] = key.includes(':') ? key.split(':') : ['common', key];
      const vaartus = path.split('.').reduce<unknown>(
        (acc, osa) => (acc && typeof acc === 'object' ? (acc as Record<string, unknown>)[osa] : undefined),
        (pakid as Record<string, unknown>)[ns],
      );
      return typeof vaartus === 'string' ? vaartus : key;
    };
  }

  it('renderdab sisufiltri keeldumise lugeja keeles', () => {
    const raw = 'content_blocked: Gemini sisufilter keeldus sellest lehest';
    expect(ocrErrorText(raw, tFrom('et'))).toContain('LOSS');
    expect(ocrErrorText(raw, tFrom('en'))).toBe(
      "Gemini's content filter refused this page. Try the LOSS model.",
    );
  });

  it('tundmatu koodi puhul näitab serveri enda sõnumit', () => {
    expect(ocrErrorText('HTTP 500: sisemine viga', tFrom('et'))).toBe('HTTP 500: sisemine viga');
  });

  it('sõnumita vea puhul langeb üldisele tekstile', () => {
    expect(ocrErrorText(null, tFrom('et'))).toBe('Tundmatu viga');
    expect(ocrErrorText(null, tFrom('en'))).toBe('Unknown error');
  });
});
