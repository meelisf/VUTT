/** @vitest-environment jsdom */
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React, { useState } from 'react';
import './testI18n';

const { translate } = vi.hoisted(() => ({ translate: vi.fn() }));
vi.mock('../../../../prosopography/services/prosopographyService', () => ({ translateText: translate }));
import PartAbstractSection from '../PartAbstractSection';
import { emptyDraft, type PartDraft } from '../../partsModel';
import { textHash } from '../../../../prosopography/utils/textHash';

let last: PartDraft;
const Harness: React.FC<{ init: Partial<PartDraft> }> = ({ init }) => {
  const [d, setD] = useState<PartDraft>({ ...emptyDraft(), ...init });
  last = d;
  return <PartAbstractSection draft={d} set={p => setD(prev => ({ ...prev, ...p }))} token="tok" />;
};

beforeEach(() => translate.mockReset());

describe('osa kokkuvõtte vorm', () => {
  it('tõlge eesti keelest täidab ingliskeelse ja märgib kinnituse', async () => {
    translate.mockResolvedValue('Letter to father.');
    render(<Harness init={{ abstract_et: 'Kiri isale.' }} />);
    fireEvent.click(screen.getByRole('button', { name: 'Inglise keeles' }));
    fireEvent.click(screen.getByRole('button', { name: /Tõlgi eesti keelest/ }));
    await waitFor(() => expect(last.abstract_en).toBe('Letter to father.'));
    expect(translate).toHaveBeenCalledWith('Kiri isale.', 'et', 'en', 'tok');
    expect(last.confirmEn).toBe(true);
  });

  it('eestikeelse muutmine võtab kinnituse maha', () => {
    render(<Harness init={{ abstract_et: 'Kiri.', abstract_en: 'Letter.', confirmEn: true }} />);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Kiri 1684.' } });
    expect(last.confirmEn).toBe(false);
  });

  it('hoiatab, kui eestikeelne on pärast kinnitust muutunud', async () => {
    const anchor = await textHash('Vana kiri.');
    render(<Harness init={{ abstract_et: 'Uus kiri.', abstract_en: 'Letter.', abstractAnchor: anchor }} />);
    fireEvent.click(screen.getByRole('button', { name: 'Inglise keeles' }));
    expect(await screen.findByText(/on pärast tõlke kinnitamist muudetud/)).toBeTruthy();
  });
});
