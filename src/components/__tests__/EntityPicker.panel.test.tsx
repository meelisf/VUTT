/** @vitest-environment jsdom */
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

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
// I1: rolli mõjutavad testid seavad selle otse ümber — vaikimisi editor, et
// olemasolevad "tokeniga" testid ei muutuks.
let mockUserRole: string | undefined = 'editor';
vi.mock('../../contexts/UserContext', () => ({ useUser: () => ({ user: mockUserRole ? { role: mockUserRole } : null }) }));

import EntityPicker from '../EntityPicker';

describe('EntityPicker — isikupaneel', () => {
  beforeEach(() => { mockUserRole = 'editor'; });

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

  it('I1: contributor\'il (tokeniga) nuppu ei ole ja välise tulemuse klikk lingib otse, paneeli ei ava', async () => {
    mockUserRole = 'contributor';
    const wikidataService = await import('../../services/wikidataService');
    (wikidataService.searchWikidata as any).mockResolvedValue(
      [{ id: 'Q42', label: 'Douglas Adams', url: '' }]);
    (wikidataService.getEntityLabels as any).mockResolvedValue({ et: 'Douglas Adams', en: 'Douglas Adams' });
    const onChange = vi.fn();
    render(<EntityPicker type="person" value="" onChange={onChange} defaultPersonSearch showPersonToggle token="t" />);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Adams' } });
    fireEvent.focus(screen.getByRole('textbox'));
    expect(screen.queryByText('prosopography.panel.openButton')).toBeNull();
    fireEvent.click(await screen.findByText('Otsi Wikidatast / GND / VIAF...'));
    const result = await screen.findByText('Douglas Adams');
    fireEvent.click(result);
    await waitFor(() => expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'Q42', source: 'wikidata' })));
    expect(screen.queryByTestId('panel')).toBeNull();
  });
});
