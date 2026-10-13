/** @vitest-environment jsdom */
/**
 * Esilehe külgriba fassett (#587): nähtaval N sagedasemat, ülejäänud
 * „Näita kõiki" alt; valitud rida jääb nähtavaks ka siis, kui ta on N-st väljas;
 * otsing käib KÕIGI ridade peal, mitte ainult nähtavate.
 */
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import SearchableFilterList from '../SearchableFilterList';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));

const items = Array.from({ length: 8 }, (_, i) => ({ value: `v${i}`, label: `Žanr ${i}`, count: 100 - i }));

const labels = () => screen.queryAllByRole('checkbox').map(cb => cb.closest('label')!.textContent!.replace(/\s*\(\d+\)$/, ''));

describe('SearchableFilterList collapsedCount', () => {
  it('näitab N esimest ja ülejäänud „Näita kõiki" alt', () => {
    render(<SearchableFilterList items={items} selectedValues={[]} onToggle={() => {}} placeholder="otsi" collapsedCount={5} />);
    expect(labels()).toEqual(['Žanr 0', 'Žanr 1', 'Žanr 2', 'Žanr 3', 'Žanr 4']);
    fireEvent.click(screen.getByText('labels.showAllCount'));
    expect(labels()).toHaveLength(8);
  });

  it('valitud rida N-st väljas jääb nähtavaks', () => {
    render(<SearchableFilterList items={items} selectedValues={['v7']} onToggle={() => {}} placeholder="otsi" collapsedCount={5} />);
    expect(labels()).toContain('Žanr 7');
    expect(labels()).toHaveLength(6);
  });

  it('otsing leiab ka peidetud rea ja otsingukast on nähtav juba 8 rea juures', () => {
    render(<SearchableFilterList items={items} selectedValues={[]} onToggle={() => {}} placeholder="otsi" collapsedCount={5} />);
    fireEvent.change(screen.getByPlaceholderText('otsi'), { target: { value: 'Žanr 6' } });
    expect(labels()).toEqual(['Žanr 6']);
  });

  it('ilma collapsedCount-ita on vana käitumine: kõik read, otsing alles üle 10', () => {
    render(<SearchableFilterList items={items} selectedValues={[]} onToggle={() => {}} placeholder="otsi" />);
    expect(labels()).toHaveLength(8);
    expect(screen.queryByPlaceholderText('otsi')).toBeNull();
  });
});
