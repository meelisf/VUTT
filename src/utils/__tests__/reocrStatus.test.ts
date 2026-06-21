import { describe, it, expect } from 'vitest';
import { mapReocrState, selectableNoTextFiles, ReocrStatusResponse } from '../reocrStatus';

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
