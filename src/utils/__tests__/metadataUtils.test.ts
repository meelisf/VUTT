import { describe, it, expect } from 'vitest';
import { getLabel } from '../metadataUtils';

describe('getLabel', () => {
    it('tagastab stringi muutmata', () => {
        expect(getLabel('tartu')).toBe('Tartu');
    });

    it('tagastab tühja stringi kui väärtus puudub', () => {
        expect(getLabel(undefined)).toBe('');
        expect(getLabel(null)).toBe('');
        expect(getLabel('')).toBe('');
    });

    it('Wikidata: tagastab UI keele labeli', () => {
        const entity = { label: 'Tartu', id: 'Q3258', source: 'wikidata' as const, labels: { et: 'Tartu', en: 'Tartu', la: 'Dorpatum' } };
        expect(getLabel(entity, 'et')).toBe('Tartu');
        expect(getLabel(entity, 'en')).toBe('Tartu');
    });

    it('Wikidata: langeb et-le kui UI keel puudub', () => {
        const entity = { label: 'Funeral sermon', id: 'Q174268', source: 'wikidata' as const, labels: { et: 'Matusejutlus', en: 'Funeral sermon' } };
        expect(getLabel(entity, 'de')).toBe('Matusejutlus');
    });

    it('Wikidata: langeb en-le kui et puudub (la/de ka puudub)', () => {
        const entity = { label: 'Funeral sermon', id: 'Q174268', source: 'wikidata' as const, labels: { en: 'Funeral sermon' } };
        expect(getLabel(entity, 'et')).toBe('Funeral sermon');
    });

    it('Wikidata: langeb la-le kui et ja en puuduvad', () => {
        const entity = { label: 'Philosophia', id: 'Q5891', source: 'wikidata' as const, labels: { la: 'Philosophia', de: 'Philosophie' } };
        expect(getLabel(entity, 'et')).toBe('Philosophia');
    });

    it('Wikidata: langeb de-le kui et, en ja la puuduvad', () => {
        const entity = { label: 'Philosophie', id: 'Q5891', source: 'wikidata' as const, labels: { de: 'Philosophie' } };
        expect(getLabel(entity, 'et')).toBe('Philosophie');
    });

    it('kohalik isik (source=local): kasutab label välja, mitte labels dictionaryt', () => {
        const entity = { label: 'Johann Fischer', id: 'abc123', source: 'local' as const, labels: { en: 'John Fisher' } };
        expect(getLabel(entity, 'et')).toBe('Johann Fischer');
    });

    it('massiivi puhul kasutab esimest elementi', () => {
        const entities = [
            { label: 'Tartu', id: 'Q3258', source: 'wikidata' as const, labels: { et: 'Tartu' } },
            { label: 'Tallinn', id: 'Q1770', source: 'wikidata' as const, labels: { et: 'Tallinn' } },
        ];
        expect(getLabel(entities, 'et')).toBe('Tartu');
    });

    it('tühja massiiviga tagastab tühja stringi', () => {
        expect(getLabel([], 'et')).toBe('');
    });
});
