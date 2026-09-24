/** @vitest-environment jsdom */
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const create = vi.fn();
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string, d?: any) => (typeof d === 'string' ? d : k), i18n: { language: 'et' } }),
}));
vi.mock('../../panel/searchSources', () => ({
  searchPersonSources: vi.fn(async () => ({
    refs: [{ scheme: 'wikidata', id: 'Q1', label: 'Lorenz Luden' }, { scheme: 'gnd', id: '2', label: 'Luden' }],
    failed: ['viaf'],
  })),
}));
vi.mock('../../services/prosopographyService', async () => {
  class PersonConflictError extends Error {
    constructor(public conflict: string, public existingPersonIds: string[]) { super('c'); }
  }
  return {
    PersonConflictError,
    // Viga visatakse ümbrises, mitte vi.fn-is: vitest 4.1 raporteerib vi.fn-i tagasilükatud
    // promise'i testi veaks ka siis, kui komponent selle kinni püüab.
    createPersonChecked: async (...a: any[]) => { const r = await create(...a); if (r instanceof Error) throw r; return r; },
    fetchCandidates: vi.fn(async () => ({
      similar_persons: [{ id: 'vutt:Pold', label: 'Laurentius Ludenius', birth_year: 1592, death_year: 1654, work_count: 12 }],
      results: [
        { scheme: 'wikidata', id: 'Q1', ok: true, error: null, existing_person_id: null,
          summary: { label: 'Lorenz Luden', names: [{ text: 'Lorenz Luden', lang: 'et', kind: 'label' },
                     { text: 'Laurentius Ludenius', lang: 'mul', kind: 'alias' }],
                     description: 'jurist', birth: { date: '1592-01-01', precision: 'year', place: null },
                     death: { date: null, precision: null, place: null }, occupations: [],
                     url: 'https://www.wikidata.org/wiki/Q1', links: { gnd: '2' } } },
        { scheme: 'gnd', id: '2', ok: false, error: 'timeout', existing_person_id: null, summary: null },
      ],
    })),
  };
});

import PersonAddPanel from '../PersonAddPanel';

describe('PersonAddPanel', () => {
  beforeEach(() => create.mockReset());

  it('olemasolev isik on ees ja „Vali see" valib ta', async () => {
    const onDone = vi.fn();
    render(<PersonAddPanel initialQuery="Ludenius" token="t" lang="et" onDone={onDone} onClose={vi.fn()} />);
    const btn = await screen.findAllByText('panel.selectExisting');
    fireEvent.click(btn[0]);
    expect(onDone).toHaveBeenCalledWith({ id: 'vutt:Pold', label: 'Laurentius Ludenius', created: false });
  });

  it('WD + GND on üks kandidaat ja nimeks sobinud variant', async () => {
    render(<PersonAddPanel initialQuery="Ludenius" token="t" lang="et" onDone={vi.fn()} onClose={vi.fn()} />);
    await waitFor(() => expect(screen.getAllByTestId('candidate-row')).toHaveLength(1));
    expect(screen.getByTestId('candidate-row').textContent).toContain('Laurentius Ludenius');
  });

  it('„Loo ja vali" saadab kõik grupi ID-d ja valimata nimed aliasteks', async () => {
    create.mockResolvedValue({ id: 'vutt:Pnew', name: { label: 'Laurentius Ludenius' } });
    const onDone = vi.fn();
    render(<PersonAddPanel initialQuery="Ludenius" token="t" lang="et" onDone={onDone} onClose={vi.fn()}
                           context={{ work_id: 'w1', role: 'praeses' }} />);
    fireEvent.click(await screen.findByTestId('candidate-row'));
    fireEvent.click(await screen.findByText('panel.createAndSelect'));
    await waitFor(() => expect(onDone).toHaveBeenCalledWith({ id: 'vutt:Pnew', label: 'Laurentius Ludenius', created: true }));
    expect(create.mock.calls[0][0]).toEqual({
      name: 'Laurentius Ludenius', identifiers: [{ scheme: 'wikidata', id: 'Q1' }, { scheme: 'gnd', id: '2' }],
      aliases: ['Lorenz Luden'], context: { work_id: 'w1', role: 'praeses' }, created_via: 'picker',
    });
  });

  it('409 split ei vali midagi', async () => {
    const { PersonConflictError } = (await import('../../services/prosopographyService')) as any;
    create.mockResolvedValue(new PersonConflictError('split', ['vutt:Pa', 'vutt:Pb']));
    const onDone = vi.fn();
    render(<PersonAddPanel initialQuery="Ludenius" token="t" lang="et" onDone={onDone} onClose={vi.fn()} />);
    fireEvent.click(await screen.findByTestId('candidate-row'));
    fireEvent.click(await screen.findByText('panel.createAndSelect'));
    await screen.findByText('panel.splitConflict');
    expect(onDone).not.toHaveBeenCalled();
  });

  it('kukkunud allikas on nähtav', async () => {
    render(<PersonAddPanel initialQuery="Ludenius" token="t" lang="et" onDone={vi.fn()} onClose={vi.fn()} />);
    expect(await screen.findByText(/panel.sourceSearchFailed/)).toBeTruthy();
  });

  it('inline korral taustakatet ei renderdata', async () => {
    const { container } = render(
      <PersonAddPanel initialQuery="Ludenius" token="t" lang="et" onDone={vi.fn()} onClose={vi.fn()} inline />,
    );
    await screen.findAllByText('panel.selectExisting');
    expect(container.querySelector('.bg-black\\/30')).toBeNull();
    expect(container.querySelector('.fixed')).toBeNull();
  });

  it('loomise tõrge (mitte-konflikt) on nähtav ja onDone ei käivitu', async () => {
    // Vt kommentaari mock-mooduli juures: vi.fn-i tagasilükatud promise loetakse
    // vitest 4.1-s testi veaks ka siis, kui komponent selle kinni püüab — seega
    // resolve'ime Error-objektiga, mille wrapper `throw`-ib.
    create.mockResolvedValue(new Error('network down'));
    const onDone = vi.fn();
    render(<PersonAddPanel initialQuery="Ludenius" token="t" lang="et" onDone={onDone} onClose={vi.fn()} />);
    fireEvent.click(await screen.findByTestId('candidate-row'));
    fireEvent.click(await screen.findByText('panel.createAndSelect'));
    await screen.findByText('panel.createFailed');
    expect(onDone).not.toHaveBeenCalled();
  });
});
