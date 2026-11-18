/** @vitest-environment jsdom */
/**
 * Upload'i ülevaate kaardi märgid (ADR 0085): ootel muudatus on näha (oranž raam +
 * ikoonid, nagu teose halduse kaardil ja pisipiltide ribal); teosest välja jäetud
 * leht on punase ristiga (mitte silm — leht ei jää ainult OCR-ist välja).
 */
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import SplitContactSheet from '../SplitContactSheet';
import type { PrepressPage, PrepressPlan } from '../../types';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k, i18n: { language: 'et' } }),
}));

function plan(pages: Partial<PrepressPage>[]): PrepressPlan {
  return {
    default_split_x: 0.5, preview_status: 'ready', preview_done: pages.length, preview_cancel: false,
    page_count: pages.length, output_page_count: pages.length, trivial: true, status: 'awaiting_split',
    ocr_model: 'print',
    pages: pages.map((p, i) => ({ n: i + 1, mode: 'nosplit', split_x: null, excluded: false, rotate: 0, ...p })),
  } as PrepressPlan;
}

function renderSheet(p: PrepressPlan) {
  const onPageChange = vi.fn();
  render(
    <SplitContactSheet uploadId="u1" ticket={{ exp: 9, sig: 's' }} plan={p} gridCols={4}
      selected={new Set()} onToggleSelect={vi.fn()} onPageChange={onPageChange} onOpenPage={vi.fn()} />,
  );
  return onPageChange;
}

const KÄRBE = { angle: 0, crop: { x: 0, y: 0, w: 0.5, h: 1 }, quad: null };

describe('SplitContactSheet märgid', () => {
  it('puutumata lehel märki ei ole; muudetud lehel on oranž märk ikoonidega', () => {
    renderSheet(plan([{}, { rotate: 90, adjust: KÄRBE, mode: 'default' }]));
    expect(screen.getByTestId('page-1').dataset.pending).toBe('false');
    expect(screen.queryByTestId('pending-1')).toBeNull();
    expect(screen.getByTestId('page-2').dataset.pending).toBe('true');
    const mark = screen.getByTestId('pending-2').textContent!;
    expect(mark).toContain('90°');
    expect(mark).toContain('step3split.card.badgeCrop');
    expect(mark).toContain('step3split.card.badgeSplit');
  });

  it('välja jäetud leht: punane rist märgi asemel; nupp lülitab', () => {
    const onPageChange = renderSheet(plan([{ excluded: true, rotate: 90 }]));
    expect(screen.getByTestId('excluded-mark-1')).toBeTruthy();
    expect(screen.queryByTestId('pending-1')).toBeNull();
    const btn = screen.getByTestId('exclude-1');
    expect(btn.className).toContain('bg-red-600');
    expect(btn.getAttribute('title')).toBe('step3split.card.include');
    fireEvent.click(btn);
    expect(onPageChange).toHaveBeenCalledWith(1, { excluded: false });
  });
});
