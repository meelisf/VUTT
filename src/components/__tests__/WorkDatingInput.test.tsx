/** @vitest-environment jsdom */
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import '../../prosopography/components/relations/__tests__/testI18n';
import WorkDatingInput from '../WorkDatingInput';

describe('WorkDatingInput', () => {
  it('alguse aasta tühjendamine eemaldab dateeringu, mitte ei jäta vigast kirjet (o17ekb)', () => {
    const onChange = vi.fn();
    render(<WorkDatingInput value="1668-10" onChange={onChange}
      dating={{ start: '1667-08-06', source_text: '1668-10' }} />);
    const year = screen.getAllByRole('textbox').find(el => (el as HTMLInputElement).value === '1667')!;
    fireEvent.change(year, { target: { value: '' } });
    expect(onChange).toHaveBeenLastCalledWith('', null);
  });

  it('lõpuga dateeringu alguse tühjendamine jääb veaks (vahemik vajab algust)', () => {
    const onChange = vi.fn();
    render(<WorkDatingInput value="1667 / 1668" onChange={onChange}
      dating={{ start: '1667', end: '1668' }} />);
    const year = screen.getAllByRole('textbox').find(el => (el as HTMLInputElement).value === '1667')!;
    fireEvent.change(year, { target: { value: '' } });
    expect(onChange.mock.lastCall?.[1]).toMatchObject({ start: '', end: '1668' });
  });
});
