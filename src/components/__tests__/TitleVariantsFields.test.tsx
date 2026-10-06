/** @vitest-environment jsdom */
/**
 * Pealkirja tõlke- ja originaalilahtrid on trükistel kokku klapitud (ADR 0064):
 * avatud ainult koostatud pealkirja või juba olemasoleva väärtuse korral.
 */
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));

import TitleVariantsFields from '../TitleVariantsFields';

const renderFields = (props: Partial<React.ComponentProps<typeof TitleVariantsFields>> = {}) =>
  render(
    <TitleVariantsFields
      titleEn=""
      titleOriginal=""
      titleDevised={false}
      onChange={() => {}}
      textareaClassName=""
      {...props}
    />,
  );

describe('TitleVariantsFields', () => {
  it('trükis ilma väärtusteta: lahtrid kokku, link nähtav', () => {
    renderFields();
    expect(screen.queryAllByRole('textbox')).toHaveLength(0);
    fireEvent.click(screen.getByText(/titleVariantsAdd/));
    expect(screen.getAllByRole('textbox')).toHaveLength(2);
  });

  it('koostatud pealkiri: lahtrid avatud', () => {
    renderFields({ titleDevised: true });
    expect(screen.getAllByRole('textbox')).toHaveLength(2);
  });

  it('olemasolev väärtus ei peitu, ka liputa', () => {
    renderFields({ titleOriginal: 'Protocollum' });
    expect(screen.getByDisplayValue('Protocollum')).toBeTruthy();
  });
});
