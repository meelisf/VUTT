/** @vitest-environment jsdom */
/**
 * Ootel pööre/poolitus kaardil (#431 etapp 3): eelvaade, mitte faili muutus.
 */
import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import PageCard from '../PageCard';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k, i18n: { language: 'et' } }),
}));
vi.mock('../../../contexts/UserContext', () => ({ useUser: () => ({ authToken: 't' }) }));

const base = {
  workId: 'w1', filename: 'a.jpg', imageName: 'a.jpg', visiblePageNum: 1, status: 'Toores',
  hasText: true, isSelected: false, isChanged: false, thumbCacheBust: 0,
  onToggle: vi.fn(), onEdit: vi.fn(), splitX: 0.5,
};

describe('PageCard ootel toimingud', () => {
  it('ilma ootel toiminguta märki ega joont ei ole', () => {
    render(<PageCard {...base} />);
    expect(screen.queryByTestId('pending-op-badge')).toBeNull();
    expect(screen.queryByTestId('pending-split-line')).toBeNull();
  });

  it('poolitus näitab joont ja märki', () => {
    render(<PageCard {...base} pendingOp={{ rotate: 0, split: true }} />);
    expect(screen.getByTestId('pending-split-line')).toBeTruthy();
    expect(screen.getByTestId('pending-op-badge').textContent).toContain('manage.pageOps.badgeSplit');
  });

  it('90° pööre: pilt pööratud ja skaleeritud, joont ei näidata', () => {
    const { container } = render(<PageCard {...base} pendingOp={{ rotate: 90, split: true }} />);
    const img = container.querySelector('img') as HTMLImageElement;
    expect(img.style.transform).toBe('rotate(90deg) scale(0.75)');
    expect(screen.queryByTestId('pending-split-line')).toBeNull();
    expect(screen.getByTestId('pending-op-badge').textContent).toContain('90°');
  });
});

describe('PageCard kärbe (ADR 0061)', () => {
  it('kärpimine ja poolitamine on eraldi nähtavad nupud', () => {
    const onEdit = vi.fn();
    render(<PageCard {...base} onEdit={onEdit} />);
    screen.getByTestId('card-open-crop').click();
    screen.getByTestId('card-open-split').click();
    expect(onEdit.mock.calls).toEqual([['edit'], ['split']]);
  });

  it('ootel kärbe: märk ja serveri eelvaade (CSS-pööret pole)', () => {
    const { container } = render(<PageCard {...base} pendingOp={{ rotate: 90, split: false, adjust: { angle: 0, crop: { x: 0, y: 0, w: 1, h: 0.5 }, quad: null } }} />);
    expect(screen.getByTestId('pending-op-badge').textContent).toContain('manage.pageOps.badgeCrop');
    const img = container.querySelector('img')!;
    expect(img.getAttribute('src')).toContain('/page-image/a.jpg/preview?');
    expect(img.style.transform).toBe('');
  });
});
