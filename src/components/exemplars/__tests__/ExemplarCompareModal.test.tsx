/** @vitest-environment jsdom */
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react';
import { describe, it, expect, vi, afterEach } from 'vitest';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (k: string, o?: unknown) => (o && typeof o === 'object' ? `${k}:${JSON.stringify(o)}` : k),
  }),
}));
vi.mock('../../ImageViewer', () => ({
  default: ({ src, view }: { src: string; view?: unknown }) =>
    <img data-testid="viewer" data-controlled={view ? 'yes' : 'no'} src={src} />,
}));

import ExemplarCompareModal from '../ExemplarCompareModal';
import { PAGES_KEY, type Sequence } from '../exemplarSequences';

const pages = (n: number, ownerAt?: number): Sequence => ({
  key: PAGES_KEY, kind: 'pages',
  items: Array.from({ length: n }, (_, i) => ({
    key: `s${i + 1}`, stem: `s${i + 1}`, label: String(i + 1), url: `/p${i + 1}.jpg`, thumb: `/t${i + 1}.jpg`,
    ...(ownerAt === i ? { ownerNote: 'Riga LUAB' } : {}),
  })),
});
const images = (key: string, n: number, pairAt?: [number, string]): Sequence => ({
  key, kind: 'images', exemplarId: key,
  items: Array.from({ length: n }, (_, i) => ({
    key: `${key}-i${i}`, label: `A${i}`, url: `/${key}/${i}.jpg`, thumb: `/${key}/t${i}.jpg`,
    ...(pairAt && pairAt[0] === i ? { pairStem: pairAt[1] } : {}),
  })),
});

afterEach(cleanup);

function renderModal(over: Partial<React.ComponentProps<typeof ExemplarCompareModal>> = {}) {
  const onChange = vi.fn();
  const onSavePair = vi.fn(async () => {});
  const sequences = over.sequences ?? [pages(8), images('b2', 6), images('c3', 0)];
  render(
    <ExemplarCompareModal title="Teos" sequences={sequences}
      seqLabel={k => ({ main: k === PAGES_KEY ? 'Teose lehed' : k })}
      left={{ seq: 'b2', index: 2 }} right={{ seq: PAGES_KEY, index: 2 }}
      onChange={onChange} canEdit onSavePair={onSavePair} onClose={() => {}} {...over} />,
  );
  return { onChange, onSavePair };
}

describe('ExemplarCompareModal', () => {
  it('1. lukus: → liigutab mõlemat', () => {
    const { onChange } = renderModal();
    fireEvent.keyDown(window, { key: 'ArrowRight' });
    expect(onChange).toHaveBeenCalledWith({ seq: 'b2', index: 3 }, { seq: PAGES_KEY, index: 3 });
  });

  it('2. lukus, vasak viimasel: → ei liiguta kumbagi', () => {
    const { onChange } = renderModal({ left: { seq: 'b2', index: 5 } });
    fireEvent.keyDown(window, { key: 'ArrowRight' });
    expect(onChange).not.toHaveBeenCalled();
  });

  it('3. lukk lahti: parema poole › liigutab ainult paremat', () => {
    const { onChange } = renderModal();
    fireEvent.click(screen.getByTestId('compare-lock'));
    fireEvent.click(within(screen.getByTestId('compare-side-right')).getByLabelText('exemplarImages.compare.next'));
    expect(onChange).toHaveBeenCalledWith({ seq: 'b2', index: 2 }, { seq: PAGES_KEY, index: 3 });
  });

  it('4. „Salvesta paar" nähtav ja kutsub onSavePair', () => {
    const { onSavePair } = renderModal();
    const btn = screen.getByText(/compare\.savePair/);
    fireEvent.click(btn);
    expect(onSavePair).toHaveBeenCalledWith('b2', 'b2-i2', 's3');
  });

  it('4b. paar juba salvestatud: nupp peidetud, märge „paar salvestatud"', () => {
    renderModal({ sequences: [pages(8), images('b2', 6, [2, 's3'])] });
    expect(screen.queryByText(/compare\.savePair/)).toBeNull();
    expect(screen.getByText('compare.pairSaved')).toBeTruthy();
  });

  it('pildi paar erineb teise poole lehest → kollane märk „paar: lk N"', () => {
    renderModal({ sequences: [pages(8), images('b2', 6, [2, 's7'])] });
    expect(screen.getByText(/compare\.pairElsewhere/).textContent).toContain('"n":7');
  });

  it('5. kaks pildijada: „Salvesta paar" puudub; canEdit=false: puudub', () => {
    renderModal({ sequences: [pages(8), images('b2', 6), images('c3', 4)], right: { seq: 'c3', index: 2 } });
    expect(screen.queryByText(/compare\.savePair/)).toBeNull();
    cleanup();
    renderModal({ canEdit: false });
    expect(screen.queryByText(/compare\.savePair/)).toBeNull();
  });

  it('6. erandleht paremal: päises ownerNote', () => {
    renderModal({ sequences: [pages(8, 2), images('b2', 6)] });
    expect(within(screen.getByTestId('compare-side-right')).getByText(/Riga LUAB/)).toBeTruthy();
  });

  it('7. tühi jada on menüüs disabled', () => {
    renderModal();
    const select = within(screen.getByTestId('compare-side-left')).getByRole('combobox');
    const opt = within(select).getByText('c3') as HTMLOptionElement;
    expect(opt.disabled).toBe(true);
  });

  it('jada vahetus menüüst → onChange indeksiga 0', () => {
    const { onChange } = renderModal({ sequences: [pages(8), images('b2', 6), images('c3', 4)] });
    fireEvent.change(within(screen.getByTestId('compare-side-left')).getByRole('combobox'), { target: { value: 'c3' } });
    expect(onChange).toHaveBeenCalledWith({ seq: 'c3', index: 0 }, { seq: PAGES_KEY, index: 2 });
  });

  it('8. „suurendus koos" maha → liugur disabled, vaatur juhtimata', () => {
    renderModal();
    const slider = screen.getByLabelText('compare.zoomLevel') as HTMLInputElement;
    expect(slider.disabled).toBe(false);
    expect(screen.getAllByTestId('viewer')[0].getAttribute('data-controlled')).toBe('yes');
    fireEvent.click(screen.getByLabelText('compare.zoomTogether'));
    expect((screen.getByLabelText('compare.zoomLevel') as HTMLInputElement).disabled).toBe(true);
    expect(screen.getAllByTestId('viewer')[0].getAttribute('data-controlled')).toBe('no');
  });
});
