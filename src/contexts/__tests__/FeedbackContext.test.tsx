/** @vitest-environment jsdom */
import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (k: string) => k }) }));

import { FeedbackProvider, useConfirm, useNotify } from '../FeedbackContext';

let askConfirm: ReturnType<typeof useConfirm>;
let notify: ReturnType<typeof useNotify>;
const Probe = () => { askConfirm = useConfirm(); notify = useNotify(); return null; };
const setup = () => render(<FeedbackProvider><Probe /></FeedbackProvider>);

describe('FeedbackContext (#672)', () => {
  it('kinnitus: nupp lahendab lubaduse, modaal kaob', async () => {
    setup();
    let answer: Promise<boolean>;
    act(() => { answer = askConfirm({ message: 'Kustutan?', confirmText: 'Jah' }); });
    expect(screen.getByText('Kustutan?')).toBeTruthy();
    fireEvent.click(screen.getByText('Jah'));
    await expect(answer!).resolves.toBe(true);
    expect(screen.queryByText('Kustutan?')).toBeNull();
  });

  it('Esc = ei', async () => {
    setup();
    let answer: Promise<boolean>;
    act(() => { answer = askConfirm('Kustutan?'); });
    fireEvent.keyDown(document, { key: 'Escape' });
    await expect(answer!).resolves.toBe(false);
  });

  it('uus küsimus vana peale: vana vastus on „ei", ei jää rippuma', async () => {
    setup();
    let first: Promise<boolean>;
    act(() => { first = askConfirm('Esimene'); });
    act(() => { void askConfirm('Teine'); });
    await expect(first!).resolves.toBe(false);
    expect(screen.getByText('Teine')).toBeTruthy();
  });

  it('teade jääb, kuni suletakse; edu kaob ise', () => {
    vi.useFakeTimers();
    try {
      setup();
      act(() => { notify('Viga'); notify('Tehtud', 'success'); });
      expect(screen.getByText('Viga')).toBeTruthy();
      act(() => { vi.advanceTimersByTime(7000); });
      expect(screen.queryByText('Tehtud')).toBeNull();
      expect(screen.getByText('Viga')).toBeTruthy();
      fireEvent.click(screen.getByLabelText('buttons.close'));
      expect(screen.queryByText('Viga')).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});
