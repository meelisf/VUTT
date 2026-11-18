/** @vitest-environment jsdom */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import PageFilmstrip, { type FilmstripItem } from '../PageFilmstrip';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));

afterEach(cleanup);

const item = (key: string, over: Partial<FilmstripItem> = {}): FilmstripItem => ({
  key, src: `/img/${key}.jpg`, splitX: null, pending: null, ...over,
});

describe('PageFilmstrip', () => {
  it('märgib praeguse lehe ja viib klõpsuga teisele lehele', () => {
    const onSelect = vi.fn();
    render(<PageFilmstrip items={[item('a'), item('b'), item('c')]} currentIndex={1}
      onSelect={onSelect} testIdPrefix="t" />);
    expect(screen.getByTestId('t-filmstrip-1').getAttribute('aria-current')).toBe('page');
    expect(screen.getByTestId('t-filmstrip-0').getAttribute('aria-current')).toBeNull();
    fireEvent.click(screen.getByTestId('t-filmstrip-2'));
    expect(onSelect).toHaveBeenCalledWith(2);
  });

  it('ootel lehel on märk, puutumata lehel mitte', () => {
    render(<PageFilmstrip
      items={[item('a'), item('b', { pending: { rotate: true, crop: false, split: true } })]}
      currentIndex={0} onSelect={() => {}} testIdPrefix="t" />);
    expect(screen.getByTestId('t-filmstrip-0').dataset.pending).toBe('false');
    expect(screen.queryByTestId('t-filmstrip-pending-0')).toBeNull();
    expect(screen.getByTestId('t-filmstrip-1').dataset.pending).toBe('true');
    expect(screen.getByTestId('t-filmstrip-pending-1')).toBeTruthy();
  });

  it('joon ainult siis, kui splitX on antud', () => {
    render(<PageFilmstrip items={[item('a'), item('b', { splitX: 0.5 })]}
      currentIndex={0} onSelect={() => {}} testIdPrefix="t" />);
    expect(screen.queryByTestId('t-filmstrip-line-0')).toBeNull();
    // Kuvasuhe teadmata → pilt katab kasti laiuse, joon keskel.
    expect(screen.getByTestId('t-filmstrip-line-1').style.left).toBe('50%');
  });

  it('valmimata eelvaade (tühi src) näitab ootesümbolit, mitte pilti', () => {
    const { container } = render(<PageFilmstrip items={[item('a', { src: '' })]}
      currentIndex={0} onSelect={() => {}} testIdPrefix="t" />);
    expect(container.querySelector('img')).toBeNull();
  });
});
