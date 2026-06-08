import { describe, it, expect } from 'vitest';
import { resolveEntityLabel, pickLabelByLang } from '../labelUtils';

describe('pickLabelByLang', () => {
    it('tagastab täpse keele kui olemas', () => {
        expect(pickLabelByLang({ et: 'füüsika', en: 'physics' }, 'et')).toBe('Füüsika');
        expect(pickLabelByLang({ et: 'füüsika', en: 'physics' }, 'en')).toBe('Physics');
    });

    it('langeb et-le kui UI keel puudub', () => {
        expect(pickLabelByLang({ et: 'juhuluule' }, 'de')).toBe('Juhuluule');
    });

    it('langeb en-le kui et puudub', () => {
        expect(pickLabelByLang({ en: 'funeral sermon', la: 'oratio funebris' }, 'et')).toBe('Funeral sermon');
    });

    it('langeb la-le kui et ja en puuduvad', () => {
        expect(pickLabelByLang({ la: 'philosophia', de: 'Philosophie' }, 'et')).toBe('Philosophia');
    });

    it('langeb de-le kui et, en ja la puuduvad', () => {
        expect(pickLabelByLang({ de: 'Philosophie' }, 'et')).toBe('Philosophie');
    });

    it('tagastab tühja stringi kui kõik puuduvad', () => {
        expect(pickLabelByLang({}, 'et')).toBe('');
        expect(pickLabelByLang({ fr: 'bonjour' }, 'et')).toBe('');
    });

    it('käsitleb keelekoodi regiooniga (et-EE → et)', () => {
        expect(pickLabelByLang({ et: 'tartu', en: 'tartu' }, 'et-EE')).toBe('Tartu');
    });
});

describe('resolveEntityLabel', () => {
    const enrichedLabels: Record<string, Record<string, string>> = {
        'Q174268': { en: 'funeral sermon', la: 'oratio funebris' },
        'Q54507549': { en: 'Conrad Schultz', de: 'Conrad Schul(t)z' },
        'Q1499591': { et: 'juhuluule', en: 'occasional poetry' },
        'Q413': { et: 'füüsika', en: 'physics', la: 'physica', de: 'Physik' },
        'Q999': {},
    };

    it('tagastab UI keele labeli kui olemas', () => {
        expect(resolveEntityLabel('Q413', enrichedLabels, 'et')).toBe('Füüsika');
        expect(resolveEntityLabel('Q413', enrichedLabels, 'en')).toBe('Physics');
    });

    it('langeb et-le kui UI keel puudub', () => {
        // Q1499591 has et, lang=en fallback would use et if en missing — but en exists here
        expect(resolveEntityLabel('Q1499591', enrichedLabels, 'et')).toBe('Juhuluule');
    });

    it('langeb en-le kui et puudub (peamine bugfix — labels.json sisaldab ainult en/de)', () => {
        // Q174268: ainult en + la, ei ole et
        expect(resolveEntityLabel('Q174268', enrichedLabels, 'et')).toBe('Funeral sermon');
    });

    it('langeb en-le kui UI keel ja et puuduvad', () => {
        // Q54507549: ainult en + de
        expect(resolveEntityLabel('Q54507549', enrichedLabels, 'et')).toBe('Conrad Schultz');
    });

    it('langeb la-le kui et ja en puuduvad', () => {
        const labels = { 'Q999': { la: 'philosophia', de: 'Philosophie' } };
        expect(resolveEntityLabel('Q999', labels, 'et')).toBe('Philosophia');
    });

    it('langeb de-le kui et, en ja la puuduvad', () => {
        const labels = { 'Q999': { de: 'Philosophie' } };
        expect(resolveEntityLabel('Q999', labels, 'et')).toBe('Philosophie');
    });

    it('tagastab raw Q-koodi kui enrichedLabels kirje on tühi', () => {
        // Q999 has empty labels object {}
        expect(resolveEntityLabel('Q999', enrichedLabels, 'et')).toBe('Q999');
    });

    it('tagastab raw Q-koodi kui Q-kood pole enrichedLabels-is', () => {
        expect(resolveEntityLabel('Q99999', enrichedLabels, 'et')).toBe('Q99999');
    });

    it('kasutab fallbackMap kui enrichedLabels kirje puudub', () => {
        const fallback = { 'Q99999': 'Tundmatu teema' };
        expect(resolveEntityLabel('Q99999', enrichedLabels, 'et', fallback)).toBe('Tundmatu teema');
    });

    it('enrichedLabels on prioriteetsem kui fallbackMap', () => {
        const fallback = { 'Q413': 'Vale label' };
        expect(resolveEntityLabel('Q413', enrichedLabels, 'et', fallback)).toBe('Füüsika');
    });

    it('teeb esimese tähe suureks', () => {
        expect(resolveEntityLabel('Q174268', enrichedLabels, 'et')).toBe('Funeral sermon');
        expect(resolveEntityLabel('Q1499591', enrichedLabels, 'et')).toBe('Juhuluule');
    });

    it('tühja enrichedLabels-iga tagastab Q-koodi', () => {
        expect(resolveEntityLabel('Q413', {}, 'et')).toBe('Q413');
    });
});
