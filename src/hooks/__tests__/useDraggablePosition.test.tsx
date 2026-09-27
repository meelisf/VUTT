/** @vitest-environment jsdom */
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { useDraggablePosition } from '../useDraggablePosition';

const Panel = ({ storageKey }: { storageKey?: string }) => {
  const d = useDraggablePosition({ anchor: 'right', storageKey });
  return (
    <div ref={d.ref} style={d.style} data-testid="panel">
      <div data-testid="handle" onMouseDown={d.onHandleMouseDown}>
        päis <button type="button">x</button>
      </div>
    </div>
  );
};

// jsdom ei tee paigutust: anname paneelile mõõdud käsitsi.
const rect = { left: 500, top: 80, width: 600, height: 400, right: 1100, bottom: 480, x: 500, y: 80, toJSON: () => ({}) };
const withRect = () => { (screen.getByTestId('panel') as HTMLElement).getBoundingClientRect = () => rect as DOMRect; };

beforeEach(() => { sessionStorage.clear(); Object.assign(window, { innerWidth: 1200, innerHeight: 800 }); });
afterEach(cleanup);

describe('useDraggablePosition', () => {
  it('lohistus liigutab paneeli ja jätab asukoha seansiks meelde', () => {
    render(<Panel storageKey="k" />);
    withRect();
    fireEvent.mouseDown(screen.getByTestId('handle'), { clientX: 510, clientY: 90, button: 0 });
    fireEvent.mouseMove(window, { clientX: 310, clientY: 190 });
    fireEvent.mouseUp(window);
    expect(screen.getByTestId('panel').style.left).toBe('300px');
    expect(screen.getByTestId('panel').style.top).toBe('180px');
    cleanup();
    render(<Panel storageKey="k" />);
    expect(screen.getByTestId('panel').style.left).toBe('300px');
  });

  it('haarderiba ei kao ekraanilt', () => {
    render(<Panel />);
    withRect();
    fireEvent.mouseDown(screen.getByTestId('handle'), { clientX: 510, clientY: 90, button: 0 });
    fireEvent.mouseMove(window, { clientX: -3000, clientY: -500 });
    fireEvent.mouseUp(window);
    expect(screen.getByTestId('panel').style.left).toBe('-480px');
    expect(screen.getByTestId('panel').style.top).toBe('0px');
  });

  it('nupult alustatud vajutus ei lohista', () => {
    render(<Panel />);
    withRect();
    fireEvent.mouseDown(screen.getByRole('button'), { clientX: 510, clientY: 90, button: 0 });
    fireEvent.mouseMove(window, { clientX: 10, clientY: 10 });
    expect(screen.getByTestId('panel').style.right).toBe('24px');
    expect(screen.getByTestId('panel').style.left).toBe('');
  });

  it('meelde jäänud asukoht, mis on praegusest aknast väljas, tuuakse tagasi', () => {
    sessionStorage.setItem('k2', JSON.stringify({ x: 5000, y: 3000 }));
    render(<Panel storageKey="k2" />);
    expect(screen.getByTestId('panel').style.left).toBe('1080px');
    expect(screen.getByTestId('panel').style.top).toBe('756px');
  });

  it('akna ahenemisel piiratakse asukoht uuesti', () => {
    render(<Panel />);
    withRect();
    fireEvent.mouseDown(screen.getByTestId('handle'), { clientX: 510, clientY: 90, button: 0 });
    fireEvent.mouseMove(window, { clientX: 1000, clientY: 90 });
    fireEvent.mouseUp(window);
    expect(screen.getByTestId('panel').style.left).toBe('990px');
    Object.assign(window, { innerWidth: 700 });
    fireEvent(window, new Event('resize'));
    expect(screen.getByTestId('panel').style.left).toBe('580px');
  });
});
