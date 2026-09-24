/** @vitest-environment jsdom */
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string, d?: any) => (typeof d === 'string' ? d : k), i18n: { language: 'et' } }),
}));
vi.mock('../../prosopography/components/PersonAddPanel', () => ({
  default: (p: any) => (
    <div data-testid="panel" data-query={p.initialQuery} data-ctx={JSON.stringify(p.context ?? null)}>
      <button onClick={() => p.onDone({ id: 'vutt:Pnew', label: 'X', created: true })}>done</button>
    </div>
  ),
}));
vi.mock('../../prosopography/services/prosopographyService', () => ({ listPersons: vi.fn(async () => ({ results: [] })), getPerson: vi.fn() }));
vi.mock('../../services/wikidataService', () => ({ searchWikidata: vi.fn(async () => []), getEntityLabels: vi.fn(async () => ({})) }));
vi.mock('../../services/gndService', () => ({ searchGnd: vi.fn(async () => []) }));
vi.mock('../../services/viafService', () => ({ searchViaf: vi.fn(async () => []) }));

import EntityPicker from '../EntityPicker';

describe('EntityPicker — isikupaneel', () => {
  it('„Lisa isik…" avab paneeli kontekstiga ja valik läheb onChange-i', async () => {
    const onChange = vi.fn();
    render(<EntityPicker type="person" value="" onChange={onChange} defaultPersonSearch showPersonToggle token="t"
                         personContext={{ work_id: 'w1', role: 'praeses' }} />);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Ludenius' } });
    fireEvent.focus(screen.getByRole('textbox'));
    fireEvent.click(await screen.findByText('prosopography.panel.openButton'));
    const panel = await screen.findByTestId('panel');
    expect(panel.dataset.query).toBe('Ludenius');
    expect(JSON.parse(panel.dataset.ctx!)).toEqual({ work_id: 'w1', role: 'praeses' });
    fireEvent.click(screen.getByText('done'));
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ id: 'vutt:Pnew', label: 'X', source: 'local' }));
  });

  it('tokenita nuppu ei ole', async () => {
    render(<EntityPicker type="person" value="" onChange={vi.fn()} defaultPersonSearch showPersonToggle />);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Ludenius' } });
    fireEvent.focus(screen.getByRole('textbox'));
    expect(screen.queryByText('prosopography.panel.openButton')).toBeNull();
  });
});
