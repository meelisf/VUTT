/** @vitest-environment jsdom */
import { render, fireEvent, cleanup } from '@testing-library/react';
import { describe, it, expect, vi, afterEach } from 'vitest';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (k: string) => k }) }));

import ImageViewer from '../ImageViewer';

afterEach(() => cleanup());

const transformOf = (container: HTMLElement) =>
  (container.querySelector('.will-change-transform') as HTMLElement).style.transform;
const imageArea = (container: HTMLElement) =>
  container.querySelector('.cursor-move') as HTMLElement;

describe('ImageViewer — juhtimata (töölaud, regressioonikaitse)', () => {
  it('rull pildil muudab transform-i sisemise oleku kaudu', () => {
    const { container } = render(<ImageViewer src="/a.jpg" />);
    expect(transformOf(container)).toContain('scale(1)');
    fireEvent.wheel(imageArea(container), { deltaY: -100 });
    expect(transformOf(container)).toContain('scale(1.2)');
  });

  it('src vahetus ei muuda suurendust', () => {
    const { container, rerender } = render(<ImageViewer src="/a.jpg" />);
    fireEvent.wheel(imageArea(container), { deltaY: -100 });
    rerender(<ImageViewer src="/b.jpg" />);
    expect(transformOf(container)).toContain('scale(1.2)');
  });
});

describe('ImageViewer — juhitud (kõrvutus „suurendus koos")', () => {
  it('view antud → transform kasutab seda', () => {
    const { container } = render(<ImageViewer src="/a.jpg" view={{ scale: 2, x: 0.1, y: 0 }} onViewChange={() => {}} />);
    expect(transformOf(container)).toContain('scale(2)');
  });

  it('rull kutsub onViewChange suurema scale-iga, olek ise ei muutu', () => {
    const onViewChange = vi.fn();
    const { container } = render(<ImageViewer src="/a.jpg" view={{ scale: 2, x: 0, y: 0 }} onViewChange={onViewChange} />);
    fireEvent.wheel(imageArea(container), { deltaY: -100 });
    expect(onViewChange).toHaveBeenCalledTimes(1);
    expect(onViewChange.mock.calls[0][0].scale).toBeGreaterThan(2);
    expect(transformOf(container)).toContain('scale(2)');
  });

  it('src vahetus ei lähtesta juhitud vaadet', () => {
    const view = { scale: 2, x: 0, y: 0 };
    const { container, rerender } = render(<ImageViewer src="/a.jpg" view={view} onViewChange={() => {}} />);
    rerender(<ImageViewer src="/b.jpg" view={view} onViewChange={() => {}} />);
    expect(transformOf(container)).toContain('scale(2)');
  });

  it('nupp „lähtesta" kutsub onViewChange algvaatega', () => {
    const onViewChange = vi.fn();
    const { getByTitle } = render(<ImageViewer src="/a.jpg" view={{ scale: 3, x: 0.2, y: 0.1 }} onViewChange={onViewChange} />);
    fireEvent.click(getByTitle('imageViewer.resetView'));
    expect(onViewChange).toHaveBeenCalledWith({ scale: 1, x: 0, y: 0 });
  });
});
