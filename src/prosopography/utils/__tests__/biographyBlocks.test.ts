/**
 * Eluloo plokk + AA-plokk (spekk, otsus 4).
 *
 * AA-plokk on eluloo ahelast VÄLJAS ja renderdub ALATI, kui `aa_raw` on
 * täidetud — ka siis, kui elulugu on olemas.
 */
import { describe, expect, it } from 'vitest';
import { biographyBlocksModel } from '../biographyBlocks';

const person = (o: Record<string, unknown>) =>
  ({ biography_et: null, biography_en: null, aa_raw: null, ...o }) as any;

describe('biographyBlocksModel', () => {
  it('oma keele tekst, ilma märketa, AA-plokki ei ole', () => {
    const model = biographyBlocksModel(person({ biography_et: 'Eesti lugu.' }), 'et');
    expect(model.biography).toEqual({ text: 'Eesti lugu.', lang: 'et', isFallback: false });
    expect(model.aaRecord).toBeNull();
  });

  it('ainult ingliskeelne tekst eestikeelsele lugejale → märge', () => {
    const model = biographyBlocksModel(person({ biography_en: 'English life.' }), 'et');
    expect(model.biography).toEqual({ text: 'English life.', lang: 'en', isFallback: true });
  });

  it('AA-plokk on olemas KOOS elulooga', () => {
    const model = biographyBlocksModel(
      person({ biography_et: 'Eesti lugu.', aa_raw: '154. Lünaeus.' }), 'et');
    expect(model.biography?.text).toBe('Eesti lugu.');
    expect(model.aaRecord).toBe('154. Lünaeus.');
  });

  it('AA-kirje EI OLE eluloo varuvariant', () => {
    const model = biographyBlocksModel(person({ aa_raw: '154. Lünaeus.' }), 'et');
    expect(model.biography).toBeNull();
    expect(model.aaRecord).toBe('154. Lünaeus.');
  });

  it('ilma sisuta on mõlemad null', () => {
    const model = biographyBlocksModel(person({}), 'et');
    expect(model).toEqual({ biography: null, aaRecord: null });
  });

  it('tühikutest koosnev AA-väli loeb tühjaks', () => {
    expect(biographyBlocksModel(person({ aa_raw: '   \n ' }), 'et').aaRecord).toBeNull();
  });
});
