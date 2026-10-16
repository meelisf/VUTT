/** @vitest-environment jsdom */
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useRef } from 'react';
import '../../../pages/manage/parts/__tests__/testI18n';
import PageMarkPalette, { PageMarkMenu, readPaletteOpen } from '../PageMarkPalette';

function Harness(props: { onApply?: (k: string) => any; onClose?: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <PageMarkPalette open containerRef={ref}
        onApply={(props.onApply ?? (() => null)) as any} onClose={props.onClose ?? (() => {})} />
    </div>
  );
}

beforeEach(() => localStorage.clear());

describe('PageMarkPalette', () => {
  it('nupp rakendab liigi', () => {
    const onApply = vi.fn(() => null);
    render(<Harness onApply={onApply} />);
    fireEvent.mouseDown(screen.getByRole('button', { name: /Signatuur/ }));
    expect(onApply).toHaveBeenCalledWith('sig');
  });

  it('keeldumisel näitab põhjust', () => {
    render(<Harness onApply={() => 'pageBreak'} />);
    fireEvent.mouseDown(screen.getByRole('button', { name: /Siirdeviit/ }));
    expect(screen.getByRole('status').textContent).toMatch(/lehevahetust/);
  });

  it('× sulgeb', () => {
    const onClose = vi.fn();
    render(<Harness onClose={onClose} />);
    fireEvent.mouseDown(screen.getByTitle(/Sulge/));
    expect(onClose).toHaveBeenCalled();
  });

  it('rikutud või liiga suur asukoht klammerdatakse', () => {
    localStorage.setItem('vutt_pagemark_palette_pos', '{"x":9999,"y":9999}');
    const { container } = render(<Harness />);
    const pal = container.querySelector('[data-testid="pagemark-palette"]') as HTMLElement;
    expect(pal.style.left).toBe('0px'); // jsdom: kasti laius 0 → klammerdub 0-ks
    localStorage.setItem('vutt_pagemark_palette_pos', 'ei ole json');
    expect(() => render(<Harness />)).not.toThrow();
  });

  it('avatuse vaikeväärtus on lahti, ka ilma localStorage-ita', () => {
    expect(readPaletteOpen()).toBe(true);
    const spy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
    expect(readPaletteOpen()).toBe(true);
    spy.mockRestore();
  });
});

describe('PageMarkMenu', () => {
  it('täht valib liigi, Esc sulgeb', () => {
    const onApply = vi.fn(() => null);
    const onClose = vi.fn();
    render(<PageMarkMenu anchor={{ left: 0, top: 0 }} onApply={onApply} onClose={onClose} />);
    fireEvent.keyDown(document, { key: 'r' });
    expect(onApply).toHaveBeenCalledWith('rh');
    render(<PageMarkMenu anchor={{ left: 0, top: 0 }} onApply={onApply} onClose={onClose} />);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });
});
