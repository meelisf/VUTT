import { describe, it, expect } from 'vitest';
import { mapReocrState, selectableNoTextFiles, applicableReocrPages, ReocrStatusResponse } from '../reocrStatus';

const status: ReocrStatusResponse = {
  active: { 'a.jpg': 'processing' },
  ocr_ready: ['b'],            // stem → b.jpg
  errors: { 'c.jpg': 'viga' },
  progress: { total: 3, ready: 1, errors: 1, active: true },
};

describe('mapReocrState', () => {
  it('eristab kolm mõistet failinime/stem järgi', () => {
    expect(mapReocrState('a.jpg', status)).toBe('processing');
    expect(mapReocrState('b.jpg', status)).toBe('ocr_ready');
    expect(mapReocrState('c.jpg', status)).toBe('error');
    expect(mapReocrState('d.jpg', status)).toBeUndefined();
    expect(mapReocrState('a.jpg', null)).toBeUndefined();
  });
});

describe('selectableNoTextFiles', () => {
  it('jätab OCR-ootel ja töötavad lehed välja', () => {
    const pages = [
      { filename: 'a.jpg', has_text: false }, // active → välja
      { filename: 'b.jpg', has_text: false }, // ocr_ready → välja
      { filename: 'd.jpg', has_text: false }, // päris tekstita → sisse
      { filename: 'e.jpg', has_text: true },  // tekst olemas → välja
    ];
    expect(selectableNoTextFiles(pages, status)).toEqual(['d.jpg']);
  });
  it('ilma staatuseta võtab kõik tekstita', () => {
    const pages = [{ filename: 'a.jpg', has_text: false }, { filename: 'e.jpg', has_text: true }];
    expect(selectableNoTextFiles(pages, null)).toEqual(['a.jpg']);
  });
});

describe('applicableReocrPages', () => {
  const pages = [
    { filename: 'a.jpg', has_text: false },
    { filename: 'b.jpg', has_text: true },
    { filename: 'voeras.jpg', has_text: false },
    { filename: 'd.jpg', has_text: false },
  ];

  it('võtab ainult viimase batchi lehed, võõras ootel tulemus jääb välja', () => {
    const st: ReocrStatusResponse = {
      active: {}, errors: {}, progress: null,
      ocr_ready: ['a', 'b', 'voeras'],
      batch_ready: ['a', 'b'],
      batch_known: true,
    };
    const r = applicableReocrPages(pages, st);
    expect(r.filenames).toEqual(['a.jpg', 'b.jpg']);
    expect(r.withTextCount).toBe(1);
    expect(r.isFallback).toBe(false);
  });

  it('ilma batch-infota (server taaskäivitatud) võtab kõik ootel tulemused', () => {
    const st: ReocrStatusResponse = {
      active: {}, errors: {}, progress: null,
      ocr_ready: ['a', 'b', 'voeras'],
      batch_ready: [],
      batch_known: false,
    };
    const r = applicableReocrPages(pages, st);
    expect(r.filenames).toEqual(['a.jpg', 'b.jpg', 'voeras.jpg']);
    expect(r.withTextCount).toBe(1);
    expect(r.isFallback).toBe(true);
  });

  it('jätab välja lehe, millel käib parasjagu uus OCR', () => {
    const st: ReocrStatusResponse = {
      active: { 'a.jpg': 'processing' }, errors: {}, progress: null,
      ocr_ready: ['a', 'b'],
      batch_ready: ['a', 'b'],
      batch_known: true,
    };
    expect(applicableReocrPages(pages, st).filenames).toEqual(['b.jpg']);
  });

  it('vanad backendid ilma uute väljadeta ei kuku kokku', () => {
    const st = {
      active: {}, errors: {}, progress: null, ocr_ready: ['a'],
    } as ReocrStatusResponse;
    const r = applicableReocrPages(pages, st);
    expect(r.filenames).toEqual(['a.jpg']);
    expect(r.isFallback).toBe(true);
  });

  it('ilma staatuseta ei paku midagi', () => {
    expect(applicableReocrPages(pages, null)).toEqual({
      filenames: [], withTextCount: 0, isFallback: false,
    });
  });
});
