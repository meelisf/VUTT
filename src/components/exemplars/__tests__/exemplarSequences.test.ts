import { describe, it, expect } from 'vitest';
import type { Exemplar } from '../../../types';
import type { WorkExemplarsResponse } from '../../../services/workApi';
import type { ExemplarImage } from '../../../services/exemplarImagesService';
import {
  PAGES_KEY, defaultSelection, externalLinkLabel, hasWitness, imagesSequence, isCitationSource,
  ownPages, pageOwners, pagesSequence, stepLocked, unassignedPages, validPairStem,
} from '../exemplarSequences';

const ex = (id: string, extra: Partial<Exemplar> = {}): Exemplar => ({ id, holder: `H${id}`, ...extra });

/** Kolm lehet s1..s3; failinimed s1.jpg..s3.jpg. */
const resp = (over: Partial<WorkExemplarsResponse> = {}, files = ['s1.jpg', 's2.jpg', 's3.jpg']): WorkExemplarsResponse => ({
  exemplars: [],
  unknown_pages: [],
  page_numbers: Object.fromEntries(files.map((f, i) => [f.replace(/\.[^.]+$/, ''), i + 1])),
  page_files: files,
  page_count: files.length,
  convolutes: [],
  ...over,
});

const img = (id: string, extra: Partial<ExemplarImage> = {}): ExemplarImage =>
  ({ id, source: { kind: 'photo' }, ...extra });

describe('pageOwners', () => {
  it('erandleht → eksemplar; unknown → unknown; alus olemas → ülejäänud alusele', () => {
    const d = resp({
      exemplars: [ex('a', { text_witness: true }), ex('b', { pages: ['s2'] })],
      unknown_pages: ['s3'],
    });
    const o = pageOwners(d);
    expect(o.get('s1')).toBe('a');
    expect(o.get('s2')).toBe('b');
    expect(o.get('s3')).toBe('unknown');
  });
  it('alust pole → null', () => {
    const o = pageOwners(resp({ exemplars: [ex('a')] }));
    expect(o.get('s1')).toBeNull();
  });
});

describe('validPairStem', () => {
  it('rippuv paar → undefined (Review Focus 2)', () => {
    expect(validPairStem(img('i', { page: 'x' }), { s1: 1 })).toBeUndefined();
  });
  it('page puudub → undefined; kehtiv → tüvi', () => {
    expect(validPairStem(img('i'), { s1: 1 })).toBeUndefined();
    expect(validPairStem(img('i', { page: 's1' }), { s1: 1 })).toBe('s1');
  });
});

describe('pagesSequence', () => {
  it('kõik lehed, erandlehel ownerNote = hoidja võti', () => {
    const d = resp({ exemplars: [ex('a', { text_witness: true }), ex('b', { pages: ['s2'] })] });
    const seq = pagesSequence('w1', d);
    expect(seq.key).toBe(PAGES_KEY);
    expect(seq.kind).toBe('pages');
    expect(seq.items).toHaveLength(3);
    expect(seq.items[1].ownerNote).toBe('Hb');
    expect(seq.items[0].ownerNote).toBeUndefined();
    expect(seq.items[0].stem).toBe('s1');
  });
  it('teadmata päritoluga lehel ownerNote = unknown', () => {
    const seq = pagesSequence('w1', resp({ unknown_pages: ['s3'] }));
    expect(seq.items[2].ownerNote).toBe('unknown');
  });
  it('mitte-ASCII failinimi: url encodeURI kujul, stem kettal olev nimi', () => {
    const seq = pagesSequence('w1', resp({}, ['Liefflä-001.jpg']));
    expect(seq.items[0].url).toContain('Lieffl%C3%A4');
    expect(seq.items[0].stem).toBe('Liefflä-001');
  });
  it('vana server ilma page_files-ita → tühi jada, ei viska', () => {
    const d = resp();
    delete d.page_files;
    expect(pagesSequence('w1', d).items).toEqual([]);
  });
});

describe('imagesSequence', () => {
  it('manifesti järjekord, kehtiv paar alles, rippuv kaob', () => {
    const seq = imagesSequence('w1', 'b', [img('i1', { page: 's2', label: 'A2r' }), img('i2', { page: 'kadunud' })], { s2: 2 });
    expect(seq.kind).toBe('images');
    expect(seq.exemplarId).toBe('b');
    expect(seq.items.map(i => i.key)).toEqual(['i1', 'i2']);
    expect(seq.items[0].pairStem).toBe('s2');
    expect(seq.items[0].label).toBe('A2r');
    expect(seq.items[1].pairStem).toBeUndefined();
    expect(seq.items[0].url).toContain('/_exemplars/b/i1.jpg');
  });
});

describe('ownPages / unassignedPages', () => {
  const d = resp({
    exemplars: [ex('a', { text_witness: true }), ex('b', { pages: ['s2'] })],
    unknown_pages: ['s3'],
  });
  it('alus: ei sisalda erand- ega teadmata lehti', () => {
    expect(ownPages('w1', d, 'a').map(i => i.stem)).toEqual(['s1']);
  });
  it('erandeksemplar: ainult tema lehed', () => {
    expect(ownPages('w1', d, 'b').map(i => i.stem)).toEqual(['s2']);
  });
  it('muu eksemplar: tühi', () => {
    expect(ownPages('w1', resp({ exemplars: [ex('a'), ex('c')] }), 'c')).toEqual([]);
  });
  it('alus märkimata: kõik lehed peale erandlehtede', () => {
    const u = resp({ exemplars: [ex('b', { pages: ['s2'] })], unknown_pages: ['s3'] });
    expect(unassignedPages('w1', u).map(i => i.stem)).toEqual(['s1', 's3']);
  });
});

describe('defaultSelection / hasWitness', () => {
  it('esimene piltidega eksemplar', () => {
    const d = resp({ exemplars: [ex('a', { text_witness: true }), ex('b')], images: { b: { count: 2, preview: [] } } });
    expect(defaultSelection(d)).toBe('b');
  });
  it('pilte pole + alus → alus', () => {
    expect(defaultSelection(resp({ exemplars: [ex('x'), ex('a', { text_witness: true })] }))).toBe('a');
  });
  it('alust pole, lehti on → PAGES_KEY', () => {
    expect(defaultSelection(resp({ exemplars: [ex('a')] }, ['1.jpg', '2.jpg', '3.jpg', '4.jpg', '5.jpg']))).toBe(PAGES_KEY);
  });
  it('lehti pole → esimene eksemplar', () => {
    expect(defaultSelection(resp({ exemplars: [ex('a'), ex('b')] }, []))).toBe('a');
  });
  it('eksemplare 0 ja lehti 0 → null (Review Focus 1)', () => {
    expect(defaultSelection(resp({}, []))).toBeNull();
  });
  it('hasWitness', () => {
    expect(hasWitness(resp({ exemplars: [ex('a')] }))).toBe(false);
    expect(hasWitness(resp({ exemplars: [ex('a', { text_witness: true })] }))).toBe(true);
  });
});

describe('stepLocked', () => {
  it('vasak lõpus → kumbki ei liigu (Review Focus 4)', () => {
    expect(stepLocked(2, 7, 1, 3, 8)).toEqual([2, 7]);
  });
  it('algusest tagasi ei liigu; ühe pildiga pooled', () => {
    expect(stepLocked(0, 0, -1, 1, 1)).toEqual([0, 0]);
    expect(stepLocked(0, 0, 1, 1, 1)).toEqual([0, 0]);
  });
  it('mõlemad liiguvad', () => {
    expect(stepLocked(1, 4, 1, 6, 8)).toEqual([2, 5]);
    expect(stepLocked(1, 4, -1, 6, 8)).toEqual([0, 3]);
  });
});

describe('externalLinkLabel', () => {
  it('ADA, ESTER, muu host, vigane', () => {
    expect(externalLinkLabel('http://hdl.handle.net/10062/14332')).toBe('ADA');
    expect(externalLinkLabel('https://dspace.ut.ee/handle/10062/1')).toBe('ADA');
    expect(externalLinkLabel('https://www.ester.ee/record=b1234567~S1*est')).toBe('ESTER');
    expect(externalLinkLabel('https://www.alvin-portal.org/alvin/view.jsf?pid=x')).toBe('Alvin');
    expect(externalLinkLabel('https://www.digar.ee/arhiiv/et/1')).toBe('DIGAR');
    expect(externalLinkLabel('http://libris.kb.se/bib/1')).toBe('Libris');
    expect(externalLinkLabel('https://www.e-rara.ch/x')).toBe('e-rara.ch');
    expect(externalLinkLabel('pole url')).toBe('link');
  });
});

describe('isCitationSource', () => {
  it('viiteallikad nähtavad, tehnilised mitte', () => {
    expect(isCitationSource('jaanson')).toBe(true);
    expect(isCitationSource('ester')).toBe(true);
    expect(isCitationSource('ada')).toBe(true);
    expect(isCitationSource('migration')).toBe(false);
    expect(isCitationSource('manual')).toBe(false);
    expect(isCitationSource(undefined)).toBe(false);
  });
});
