import { describe, it, expect, beforeAll, vi } from 'vitest';

/**
 * Otsast-otsani kontroll i18n käivitusteele (#187).
 *
 * See on muudatuse riskantseim osa: staatiliste `resources`-ite asemel laeb
 * i18next nimeruume nüüd laisa backendi kaudu ja `fallbackLng` on välja
 * lülitatud. Kui backend midagi valesti tagastab, ei visata viga — kasutaja
 * lihtsalt näeb tõlkevõtmeid. Seetõttu kontrollime päris initsialiseerimist.
 */

const store = new Map<string, string>();

beforeAll(() => {
  // i18n.ts loeb brauseri API-sid; node-keskkonnas anname minimaalse topelti.
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  });
  vi.stubGlobal('navigator', { languages: ['et-EE', 'et'], language: 'et-EE' });
});

describe('i18n käivitus laisa backendiga', () => {
  it('laeb tuvastatud keele ja lahendab võtmed', async () => {
    const { i18nReady, default: i18n } = await import('../../i18n');
    await i18nReady;

    expect(i18n.language).toBe('et');
    expect(i18n.t('app.subtitle')).toBe('Varauusaegsete tekstide töölaud');
    expect(i18n.t('buttons.search')).toBe('Otsi');
  });

  it('lahendab võtmeid ka mujalt kui vaikimisi nimeruumist', async () => {
    const { i18nReady, default: i18n } = await import('../../i18n');
    await i18nReady;

    // `workspace` nimeruum peab olema samast pakist kaasa tulnud
    expect(i18n.t('workspace:tabs.edit')).not.toBe('tabs.edit');
  });

  it('keelevahetus laeb teise paki ja tõlked muutuvad', async () => {
    const { i18nReady, default: i18n } = await import('../../i18n');
    await i18nReady;

    await i18n.changeLanguage('en');
    expect(i18n.language).toBe('en');
    expect(i18n.t('app.subtitle')).toBe('Early Modern Text Workbench');
    expect(i18n.t('buttons.search')).toBe('Search');
  });

  it('keelevalik salvestatakse localStorage-isse', async () => {
    const { i18nReady, default: i18n } = await import('../../i18n');
    await i18nReady;

    await i18n.changeLanguage('en');
    expect(store.get('vutt_language')).toBe('en');
  });
});
