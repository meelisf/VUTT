/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import DateField from '../DateField';
import { emptyDateDraft } from '../types';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('../../../../components/EntityPicker', () => ({ default: () => null }));
afterEach(cleanup);

describe('life date discoverability', () => {
  it('always exposes year, month, day and the place field; only date qualifiers collapse', () => {
    render(<DateField label="Sünd" value={emptyDateDraft()} onChange={() => {}} showPlace={false}
      placeField={<input aria-label="Päritolu" />} />);
    expect(screen.getAllByRole('spinbutton')).toHaveLength(3);
    expect(screen.getByRole('textbox', { name: 'Päritolu' })).toBeTruthy();
    expect(screen.queryByRole('checkbox')).toBeNull();
    const toggle = screen.getByRole('button', { name: 'dateField.more' });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(toggle);
    expect(screen.getByRole('checkbox')).toBeTruthy();
    expect(screen.getAllByRole('combobox')).toHaveLength(2);
    expect(screen.getByRole('textbox', { name: 'Päritolu' })).toBeTruthy();
  });
  it('opens filled date qualifiers automatically', () => {
    render(<DateField label="Surm" value={{ ...emptyDateDraft(), calendar: 'julian' }} onChange={() => {}} showPlace={false} />);
    expect(screen.getByRole('button').getAttribute('aria-expanded')).toBe('true');
  });
});
