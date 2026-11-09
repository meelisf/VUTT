/** @vitest-environment jsdom */
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, afterEach } from 'vitest';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string, o?: Record<string, unknown>) => (o ? `${k}:${JSON.stringify(o)}` : k) }),
}));

import ExemplarCompare from '../ExemplarCompare';

const pages = [
  { pageNum: 1, stem: 'w-001', imageUrl: '/api/images/f/w-001.jpg' },
  { pageNum: 2, stem: 'w-002', imageUrl: '/api/images/f/w-002.jpg' },
  { pageNum: 3, stem: 'w-003', imageUrl: '/api/images/f/w-003.jpg' },
];
const image = { id: 'img001', page: 'w-002', source: { kind: 'photo' as const } };

afterEach(cleanup);

function setup(over: Partial<React.ComponentProps<typeof ExemplarCompare>> = {}) {
  const onStemChange = vi.fn();
  const onSavePair = vi.fn().mockResolvedValue(undefined);
  render(
    <ExemplarCompare workId="w1" exemplarId="a1b2c3" image={image} pages={pages} stem="w-002"
      onStemChange={onStemChange} onSavePair={onSavePair} canEdit imageToken={null} {...over} />,
  );
  return { onStemChange, onSavePair };
}

describe('ExemplarCompare', () => {
  it('parem pool näitab valitud tüve; vasak eksemplari pilti', () => {
    setup();
    expect(screen.getByTestId('compare-witness').getAttribute('src')).toBe('/api/images/f/w-002.jpg');
    expect(screen.getByTestId('compare-exemplar').getAttribute('src')).toBe('/api/images/w1/_exemplars/a1b2c3/img001.jpg');
  });

  it('nooled vahetavad paremat lehte sõltumatult', () => {
    const { onStemChange } = setup();
    fireEvent.click(screen.getByLabelText('exemplarImages.compare.next'));
    expect(onStemChange).toHaveBeenCalledWith('w-003');
    fireEvent.click(screen.getByLabelText('exemplarImages.compare.prev'));
    expect(onStemChange).toHaveBeenCalledWith('w-001');
  });

  it('olematu tüvi → paar puudub, viga ei ole', () => {
    setup({ stem: 'kadunud' });
    expect(screen.getByText('exemplarImages.compare.noPair')).toBeTruthy();
    expect(screen.queryByTestId('compare-witness')).toBeNull();
  });

  it('salvesta paar saadab valitud tüve; sama tüvega nupp puudub', () => {
    const { onSavePair } = setup({ stem: 'w-003' });
    fireEvent.click(screen.getByText('exemplarImages.compare.savePair'));
    expect(onSavePair).toHaveBeenCalledWith('w-003');
    cleanup();
    setup({ stem: 'w-002' });
    expect(screen.queryByText('exemplarImages.compare.savePair')).toBeNull();
  });

  it('mitte-toimetaja ei saa paari salvestada', () => {
    setup({ stem: 'w-003', canEdit: false });
    expect(screen.queryByText('exemplarImages.compare.savePair')).toBeNull();
  });
});
