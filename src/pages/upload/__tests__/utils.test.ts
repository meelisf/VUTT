import { describe, expect, it } from 'vitest';
import {
  computeReviewDerived,
  estimateRemainingSeconds,
  formatEta,
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
  // Varem tagastas see teadmata lehekülgede korral "~10 min" — huupi number,
  // mida UI esitas faktina juba enne faili valimist. Teadmatust ei tohi
  // maskeerida: null → kutsuja kuvab numbrita sõnastuse.
  it('tagastab null, kui lehekülgede arv on teadmata', () => {
    expect(ocrEstimate(null)).toBeNull();
    expect(ocrEstimate(undefined)).toBeNull();
    expect(ocrEstimate(0)).toBeNull();
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

describe('estimateRemainingSeconds', () => {
  it('arvutab jäänud aja mõõdetud kiirusest', () => {
    // 34,8 MB 160 MB-st 12 minutiga → ~47 kB/s → jäänud ~43 min
    const sec = estimateRemainingSeconds(34_800_000, 160_070_484, 12 * 60_000);
    expect(sec).not.toBeNull();
    expect(Math.round(sec! / 60)).toBe(43);
  });

  it('tagastab null, kui mõõtmiseks on veel liiga vähe andmeid', () => {
    expect(estimateRemainingSeconds(0, 160_000_000, 10_000)).toBeNull();
    expect(estimateRemainingSeconds(5000, 160_000_000, 1_000)).toBeNull();
  });

  it('tagastab 0, kui kõik on saadetud', () => {
    expect(estimateRemainingSeconds(160_000_000, 160_000_000, 60_000)).toBe(0);
  });
});

describe('formatEta', () => {
  it('kuvab alla minuti eraldi', () => {
    expect(formatEta(20)).toBe('< 1 min');
  });

  it('kuvab minutid', () => {
    expect(formatEta(2580)).toBe('43 min');
  });

  it('kuvab tunnid ja minutid', () => {
    expect(formatEta(3900)).toBe('1 h 5 min');
  });
});

describe('computeReviewDerived', () => {
  const baseFiles = [
    { page: 1, filename: '1.jpg', has_ocr: true, deleted: false },
    { page: 2, filename: '2.jpg', has_ocr: true, deleted: false },
    { page: 3, filename: '3.jpg', has_ocr: false, deleted: false },
  ];

  // --- kohatäited: töö KUJU nähtavaks kohe, mitte alles esimeste lehtede järel ---

  it('teeb kohatäited lehtedele, mida server pole veel avaldanud', () => {
    const poll: PollResult = {
      status: 'processing', ready: 1, total: 2, expected_pages: 33,
      planned_pages: 60,                    // 33 lähtelehte + 27 poolitust
      files: [
        { page: 1, filename: '1.jpg', has_ocr: true, deleted: false },
        { page: 2, filename: '2.jpg', has_ocr: false, deleted: false },
      ],
    };
    const out = computeReviewDerived(poll, new Set(), null, false);
    expect(out.placeholderPages).toHaveLength(58);
    expect(out.placeholderPages[0]).toBe(3);
    expect(out.placeholderPages).not.toContain(1);
  });

  it('kasutab expected_pages, kui planned_pages puudub (ilma poolitamiseta)', () => {
    const poll: PollResult = {
      status: 'processing', ready: 0, total: 0, expected_pages: 4, files: [],
    };
    const out = computeReviewDerived(poll, new Set(), null, false);
    expect(out.placeholderPages).toEqual([1, 2, 3, 4]);
  });

  it('imporditud tööl kohatäiteid ei ole', () => {
    const poll: PollResult = {
      status: 'imported', ready: 1, total: 1, expected_pages: 10,
      files: [{ page: 1, filename: '1.jpg', has_ocr: true, deleted: false }],
    };
    const out = computeReviewDerived(poll, new Set(), null, false);
    expect(out.placeholderPages).toEqual([]);
  });

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

  // Brauser → VUTT faas: polling ei tea sellest midagi (backend pole faili veel
  // saanud), aga aeglases võrgus on see just see faas, mis kestab tunni.
  it('eelistab brauseri saatmise edenemist, kui fail on veel teel serverisse', () => {
    const poll: PollResult = {
      status: 'uploading', ready: 0, total: 0, expected_pages: null, files: [],
    };
    const out = computeReviewDerived(poll, new Set(), null, false, Date.now(), {
      bytes_sent: 16_000_000,
      bytes_total: 160_000_000,
    });
    expect(out.progressPct).toBe(10);
    expect(out.progress?.bytes_total).toBe(160_000_000);
  });

  // Polling vastab saatmise ajal "pending" (backend pole faili veel näinud) ja
  // kirjutas optimistliku "uploading" olekut üle → riba kadus ja tekst hüppas
  // "OCR server töötleb…" peale, kuigi fail alles liikus brauserist serverisse.
  it('hoiab kuvatava staatuse "uploading" senikaua kuni brauser veel saadab', () => {
    const poll: PollResult = {
      status: 'pending', ready: 0, total: 0, expected_pages: null, files: [],
    };
    const out = computeReviewDerived(poll, new Set(), null, false, Date.now(), {
      bytes_sent: 11_378_688,
      bytes_total: 160_070_484,
    });
    expect(out.status).toBe('uploading');
    expect(out.canImport).toBe(false);
  });

  it('läheb tagasi serveri edastuse progressile, kui brauseri saatmine on lõpetatud', () => {
    const poll: PollResult = {
      status: 'uploading', ready: 0, total: 0, expected_pages: null, files: [],
      progress: { bytes_sent: 30, bytes_total: 200 },
    };
    const out = computeReviewDerived(poll, new Set(), null, false, Date.now(), null);
    expect(out.progressPct).toBe(15);
  });

  it('tagastab tühjad väärtused kui pollResult on null', () => {
    const out = computeReviewDerived(null, new Set(), null, false);
    expect(out.status).toBe('');
    expect(out.readyCount).toBe(0);
    expect(out.progressPct).toBe(0);
    expect(out.canImport).toBe(false);
  });
});
