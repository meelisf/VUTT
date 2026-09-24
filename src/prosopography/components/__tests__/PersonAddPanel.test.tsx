/** @vitest-environment jsdom */
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

// vi.mock() hoistitakse faili tippu — otseselt factory KEHAS viidatud
// muutujad peavad olema loodud `vi.hoisted()`-iga, muidu on TDZ-viga
// (vt vitest.dev/api/vi.html#vi-mock). Lazy closure'i sees (nagu allpool
// `createPersonChecked`) piisab tavalisest top-level `const`-ist, sest
// seda loetakse alles hiljem, mitte factory registreerimisel.
const { create, searchPersonSourcesMock, fetchCandidatesMock, getPersonMock, defaultFetchCandidates } = vi.hoisted(() => {
  const create = vi.fn();
  const defaultFetchCandidates = async () => ({
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
  });
  return {
    create,
    defaultFetchCandidates,
    searchPersonSourcesMock: vi.fn(async () => ({
      refs: [{ scheme: 'wikidata', id: 'Q1', label: 'Lorenz Luden' }, { scheme: 'gnd', id: '2', label: 'Luden' }],
      failed: ['viaf'],
    })),
    fetchCandidatesMock: vi.fn(defaultFetchCandidates),
    getPersonMock: vi.fn(),
  };
});
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string, d?: any) => (typeof d === 'string' ? d : k), i18n: { language: 'et' } }),
}));
vi.mock('../../panel/searchSources', () => ({
  searchPersonSources: searchPersonSourcesMock,
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
    fetchCandidates: fetchCandidatesMock,
    getPerson: getPersonMock,
  };
});

import PersonAddPanel from '../PersonAddPanel';

describe('PersonAddPanel', () => {
  beforeEach(() => {
    create.mockReset();
    fetchCandidatesMock.mockReset();
    fetchCandidatesMock.mockImplementation(defaultFetchCandidates);
    searchPersonSourcesMock.mockClear();
    getPersonMock.mockReset();
  });

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

  it('inline korral taustakatet ega sulgemisnuppu ei renderdata', async () => {
    const { container } = render(
      <PersonAddPanel initialQuery="Ludenius" token="t" lang="et" onDone={vi.fn()} onClose={vi.fn()} inline />,
    );
    await screen.findAllByText('panel.selectExisting');
    expect(container.querySelector('.bg-black\\/30')).toBeNull();
    expect(container.querySelector('.fixed')).toBeNull();
    expect(screen.queryByLabelText('common:buttons.close')).toBeNull();
  });

  it('külgpaneelina renderdub sulgemisnupp', async () => {
    render(<PersonAddPanel initialQuery="Ludenius" token="t" lang="et" onDone={vi.fn()} onClose={vi.fn()} />);
    await screen.findAllByText('panel.selectExisting');
    expect(screen.getByLabelText('common:buttons.close')).toBeTruthy();
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

  it('I2: kandidaatide laadimise tõrge näitab candidatesFailed, mitte noResults', async () => {
    fetchCandidatesMock.mockRejectedValueOnce(new Error('500'));
    render(<PersonAddPanel initialQuery="Ludenius" token="t" lang="et" onDone={vi.fn()} onClose={vi.fn()} />);
    await screen.findByText('panel.candidatesFailed');
    expect(screen.queryByText('panel.noResults')).toBeNull();
  });

  it('I2: uus otsing puhastab eelmise tõrke', async () => {
    fetchCandidatesMock.mockRejectedValueOnce(new Error('500'));
    render(<PersonAddPanel initialQuery="Ludenius" token="t" lang="et" onDone={vi.fn()} onClose={vi.fn()} />);
    await screen.findByText('panel.candidatesFailed');
    fireEvent.change(screen.getByPlaceholderText('panel.searchPlaceholder'), { target: { value: 'Muu' } });
    await waitFor(() => expect(screen.queryByText('panel.candidatesFailed')).toBeNull());
  });

  it('I3: focusRef antakse otsingule edasi', async () => {
    const focusRef = { scheme: 'gnd' as const, id: '999' };
    render(<PersonAddPanel initialQuery="Ludenius" token="t" lang="et" onDone={vi.fn()} onClose={vi.fn()} focusRef={focusRef} />);
    await waitFor(() => expect(searchPersonSourcesMock).toHaveBeenCalledWith('Ludenius', 'et', focusRef));
  });

  it('I4: mitte-inimese WD-tulemus ilma GND/VIAF-ita peidetakse', async () => {
    fetchCandidatesMock.mockResolvedValueOnce({
      similar_persons: [],
      results: [
        { scheme: 'wikidata', id: 'Q999', ok: true, error: null, existing_person_id: null,
          summary: { label: 'Asutus X', names: [], description: null,
                     birth: { date: null, precision: null, place: null }, death: { date: null, precision: null, place: null },
                     occupations: [], url: '', links: {}, is_human: false } },
      ],
    } as any);
    render(<PersonAddPanel initialQuery="X" token="t" lang="et" onDone={vi.fn()} onClose={vi.fn()} />);
    await waitFor(() => expect(screen.getByText('panel.noResults')).toBeTruthy());
    expect(screen.queryAllByTestId('candidate-row')).toHaveLength(0);
  });

  it('I4: mitte-inimese WD-tulemus koos GND vastega jääb nähtavaks', async () => {
    fetchCandidatesMock.mockResolvedValueOnce({
      similar_persons: [],
      results: [
        { scheme: 'wikidata', id: 'Q999', ok: true, error: null, existing_person_id: null,
          summary: { label: 'Ebaselge', names: [], description: null,
                     birth: { date: null, precision: null, place: null }, death: { date: null, precision: null, place: null },
                     occupations: [], url: '', links: { gnd: '2' }, is_human: false } },
        { scheme: 'gnd', id: '2', ok: true, error: null, existing_person_id: null,
          summary: { label: 'Ebaselge Isik', names: [], description: null,
                     birth: { date: null, precision: null, place: null }, death: { date: null, precision: null, place: null },
                     occupations: [], url: '', links: {}, is_human: true } },
      ],
    } as any);
    render(<PersonAddPanel initialQuery="X" token="t" lang="et" onDone={vi.fn()} onClose={vi.fn()} />);
    await waitFor(() => expect(screen.getAllByTestId('candidate-row')).toHaveLength(1));
  });

  it('I5: 409 exists hangib kanoonilise nime getPerson-iga', async () => {
    const { PersonConflictError } = (await import('../../services/prosopographyService')) as any;
    create.mockResolvedValue(new PersonConflictError('exists', ['vutt:Pexisting']));
    getPersonMock.mockResolvedValue({ name: { label: 'Kanooniline Nimi' } });
    const onDone = vi.fn();
    render(<PersonAddPanel initialQuery="Ludenius" token="t" lang="et" onDone={onDone} onClose={vi.fn()} />);
    fireEvent.click(await screen.findByTestId('candidate-row'));
    fireEvent.click(await screen.findByText('panel.createAndSelect'));
    await waitFor(() => expect(onDone).toHaveBeenCalledWith({ id: 'vutt:Pexisting', label: 'Kanooniline Nimi', created: false }));
    expect(getPersonMock).toHaveBeenCalledWith('vutt:Pexisting');
  });

  it('I5: getPerson ebaõnnestumisel kasutatakse fallback-nime, id säilib', async () => {
    const { PersonConflictError } = (await import('../../services/prosopographyService')) as any;
    create.mockResolvedValue(new PersonConflictError('exists', ['vutt:Pexisting']));
    getPersonMock.mockRejectedValue(new Error('404'));
    const onDone = vi.fn();
    render(<PersonAddPanel initialQuery="Ludenius" token="t" lang="et" onDone={onDone} onClose={vi.fn()} />);
    fireEvent.click(await screen.findByTestId('candidate-row'));
    fireEvent.click(await screen.findByText('panel.createAndSelect'));
    await waitFor(() => expect(onDone).toHaveBeenCalledWith({ id: 'vutt:Pexisting', label: 'Laurentius Ludenius', created: false }));
  });

  it('I6: "Ei leia allikatest" laiendi nupp kasutab eraldi võtit (mitte manualForm)', async () => {
    render(<PersonAddPanel initialQuery="Ludenius" token="t" lang="et" onDone={vi.fn()} onClose={vi.fn()} />);
    await screen.findAllByText('panel.selectExisting');
    expect(screen.getByText('panel.createWithoutSource')).toBeTruthy();
    expect(screen.queryByText('panel.manualForm')).toBeNull();
  });

  it('M2: klaviatuurisündmus select-i seest ei sule kandidaadirida', async () => {
    const { container } = render(<PersonAddPanel initialQuery="Ludenius" token="t" lang="et" onDone={vi.fn()} onClose={vi.fn()} />);
    const row = await screen.findByTestId('candidate-row');
    fireEvent.click(row);
    const select = container.querySelector('select');
    expect(select).toBeTruthy();
    fireEvent.keyDown(select!, { key: 'Enter' });
    // Kui select-i Enter oleks bubble'inud rea toggle'ini, oleks rida kinni ja select kadunud.
    expect(container.querySelector('select')).toBeTruthy();
  });

  it('M4: loomise ajal on kõik "Loo ja vali" nupud keelatud ja sulgemine ignoreeritakse', async () => {
    let resolveCreate: (v: any) => void = () => {};
    create.mockImplementation(() => new Promise(resolve => { resolveCreate = resolve; }));
    const onClose = vi.fn();
    render(<PersonAddPanel initialQuery="Ludenius" token="t" lang="et" onDone={vi.fn()} onClose={onClose} />);
    fireEvent.click(await screen.findByTestId('candidate-row'));
    const createBtn = (await screen.findByText('panel.createAndSelect')) as HTMLButtonElement;
    fireEvent.click(createBtn);
    await waitFor(() => expect(createBtn.disabled).toBe(true));

    fireEvent.click(screen.getByLabelText('common:buttons.close'));
    expect(onClose).not.toHaveBeenCalled();

    resolveCreate({ id: 'vutt:Pnew', name: { label: 'X' } });
    await waitFor(() => expect(createBtn.disabled).toBe(false));
  });
});
