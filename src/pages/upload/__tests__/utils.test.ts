import { describe, expect, it } from 'vitest';
import {
  computeReviewDerived,
  isImageFile,
  ocrEstimate,
  prepareMultiImages,
  sanitizeSlug,
} from '../utils';
import { OCR_MS_PER_PAGE, OCR_TIMEOUT_MS_FALLBACK } from '../constants';
import type { PollResult } from '../types';

describe('sanitizeSlug', () => {
  it('teisendab diakriitikud ja tühikud sidekriipsudeks', () => {
    expect(sanitizeSlug('Tartu Ülikool 1632')).toBe('tartu-ulikool-1632');
  });

  it('eemaldab lõpust üleliigsed sidekriipsud', () => {
    expect(sanitizeSlug('Teos!!!')).toBe('teos');
  });

  it('tagastab varuväärtuse tühja sisendi korral', () => {
    expect(sanitizeSlug('---')).toBe('teos');
  });
});

describe('ocrEstimate', () => {
  it('tagastab varuhinnangu kui lehekülgi pole', () => {
    expect(ocrEstimate(null)).toBe('~10 min');
    expect(ocrEstimate(undefined)).toBe('~10 min');
    expect(ocrEstimate(0)).toBe('~10 min');
  });

  it('arvutab minutid lehekülgede arvust (ümardab üles)', () => {
    expect(ocrEstimate(5)).toBe('~2 min'); // 5 / 2.5 = 2
    expect(ocrEstimate(6)).toBe('~3 min'); // 6 / 2.5 = 2.4 → 3
  });
});

describe('isImageFile', () => {
  it('tunneb ära pildilaiendid (tõstutundetult)', () => {
    expect(isImageFile('lk1.JPG')).toBe(true);
    expect(isImageFile('lk1.jpeg')).toBe(true);
    expect(isImageFile('lk1.png')).toBe(true);
    expect(isImageFile('lk1.tiff')).toBe(true);
  });

  it('lükkab tagasi mitte-pildid', () => {
    expect(isImageFile('teos.pdf')).toBe(false);
    expect(isImageFile('teos')).toBe(false);
  });
});

describe('prepareMultiImages', () => {
  const mk = (name: string) => new File(['x'], name);

  it('tagastab pildid nime järgi sorteerituna', () => {
    const out = prepareMultiImages([mk('b.jpg'), mk('a.png'), mk('c.jpeg')]);
    expect(out?.map((f) => f.name)).toEqual(['a.png', 'b.jpg', 'c.jpeg']);
  });

  it('tagastab null kui kasvõi üks fail pole pilt (nt PDF segus)', () => {
    expect(prepareMultiImages([mk('a.jpg'), mk('b.pdf')])).toBeNull();
  });
});

describe('computeReviewDerived', () => {
  const baseFiles = [
    { page: 1, filename: '1.jpg', has_ocr: true, deleted: false },
    { page: 2, filename: '2.jpg', has_ocr: true, deleted: false },
    { page: 3, filename: '3.jpg', has_ocr: false, deleted: false },
  ];

  it('liidab lokaalselt kustutatud serveri kustutatutega ja loeb valmis-arvu', () => {
    const poll: PollResult = {
      status: 'done', ready: 2, total: 3, expected_pages: 3, files: baseFiles,
    };
    const out = computeReviewDerived(poll, new Set([2]), 1000, false, 2000);
    expect(out.filesWithLocalDeleted.find((f) => f.page === 2)?.deleted).toBe(true);
    expect(out.readyCount).toBe(1); // lk1 valmis & alles; lk2 kustutatud; lk3 pole OCR-itud
  });

  it('lubab impordi kui status=done ja vähemalt üks lehekülg valmis', () => {
    const poll: PollResult = {
      status: 'done', ready: 2, total: 3, expected_pages: 3, files: baseFiles,
    };
    const out = computeReviewDerived(poll, new Set(), null, false);
    expect(out.canImport).toBe(true);
  });

  it('keelab impordi kui import juba käib', () => {
    const poll: PollResult = {
      status: 'done', ready: 2, total: 3, expected_pages: 3, files: baseFiles,
    };
    expect(computeReviewDerived(poll, new Set(), null, true).canImport).toBe(false);
  });

  it('märgib OCR timeout-iks kui aega on möödunud üle limiidi ja status pole done', () => {
    const poll: PollResult = {
      status: 'processing', ready: 1, total: 3, expected_pages: 3, files: baseFiles,
    };
    const timeoutMs = 3 * OCR_MS_PER_PAGE; // expected_pages=3 → max(5min, 3*60s)=5min
    const now = 1000 + Math.max(5 * 60 * 1000, timeoutMs) + 1;
    const out = computeReviewDerived(poll, new Set(), 1000, false, now);
    expect(out.ocrTimedOut).toBe(true);
    expect(out.canImport).toBe(true); // timeout + valmis lehekülg lubab importi
  });

  it('kasutab varu-timeout-i kui lehekülgede arv teadmata', () => {
    const poll: PollResult = {
      status: 'processing', ready: 0, total: 0, expected_pages: null, files: [],
    };
    const out = computeReviewDerived(poll, new Set(), 0, false, OCR_TIMEOUT_MS_FALLBACK - 1);
    expect(out.ocrTimeoutMs).toBe(OCR_TIMEOUT_MS_FALLBACK);
    expect(out.ocrTimedOut).toBe(false);
  });

  it('arvutab progressi protsendi baitidest', () => {
    const poll: PollResult = {
      status: 'uploading', ready: 0, total: 0, expected_pages: null, files: [],
      progress: { bytes_sent: 50, bytes_total: 200 },
    };
    expect(computeReviewDerived(poll, new Set(), null, false).progressPct).toBe(25);
  });

  it('tagastab tühjad väärtused kui pollResult on null', () => {
    const out = computeReviewDerived(null, new Set(), null, false);
    expect(out.status).toBe('');
    expect(out.readyCount).toBe(0);
    expect(out.progressPct).toBe(0);
    expect(out.canImport).toBe(false);
  });
});
