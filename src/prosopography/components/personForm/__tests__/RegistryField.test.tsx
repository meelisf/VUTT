/** @vitest-environment jsdom */
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, it, expect, vi } from 'vitest';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string, d?: any) => (typeof d === 'string' ? d : k), i18n: { language: 'et' } }),
}));
vi.mock('../../../services/prosopographyService', () => ({ listPersons: vi.fn(async () => ({ results: [] })), getPerson: vi.fn() }));
vi.mock('../../../../services/wikidataService', () => ({
  searchWikidata: vi.fn(async () => [{ id: 'Q28966944', label: 'Academia Gustaviana', description: 'wd', url: '' }]),
  getEntityLabels: vi.fn(async () => ({})),
}));
vi.mock('../../../../services/gndService', () => ({ searchGnd: vi.fn(async () => []) }));
vi.mock('../../../../services/viafService', () => ({ searchViaf: vi.fn(async () => []) }));
vi.mock('../../../../contexts/UserContext', () => ({ useUser: () => ({ user: { role: 'editor' } }) }));

import RegistryField from '../RegistryField';

const REG = { 'academia-gustavo-carolina': { id: 'Q138710754', labels: { et: 'Academia Gustavo-Carolina' }, variants: ['AGC'], place_key: 'Dorpat' } };

function setup(registryKey?: string) {
  const onPick = vi.fn(); const onUnlink = vi.fn(); const onChange = vi.fn();
  render(<MemoryRouter><RegistryField registry={REG} placeholder="p" lang="et" value={null} registryKey={registryKey}
    onChange={onChange} onPick={onPick} onUnlink={onUnlink} /></MemoryRouter>);
  return { onPick, onUnlink, onChange };
}

describe('RegistryField', () => {
  it('registri vaste on esimene ja valik läheb onPick-i koos trükitud tekstiga', async () => {
    const { onPick, onChange } = setup();
    const box = screen.getByRole('textbox');
    fireEvent.focus(box);
    fireEvent.change(box, { target: { value: 'AGC' } });
    const row = await screen.findByText('Academia Gustavo-Carolina');
    await screen.findByText('Academia Gustaviana');                      // Wikidata tuleb järel
    const labels = screen.getAllByText(/Academia Gustav/).map(e => e.textContent);
    expect(labels[0]).toBe('Academia Gustavo-Carolina');
    fireEvent.mouseDown(row); fireEvent.click(row);
    expect(onPick).toHaveBeenCalledWith(expect.objectContaining({ key: 'academia-gustavo-carolina' }), 'AGC');
    expect(onChange).not.toHaveBeenCalled();
  });

  it('seotud kirje kiip ja lahtisidumine', () => {
    const { onUnlink } = setup('academia-gustavo-carolina');
    expect(screen.getByText(/Academia Gustavo-Carolina · Q138710754/)).toBeTruthy();
    fireEvent.click(screen.getByLabelText('form.registry.unlink'));
    expect(onUnlink).toHaveBeenCalled();
  });
});
