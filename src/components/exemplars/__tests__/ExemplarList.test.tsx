/** @vitest-environment jsdom */
import React, { useCallback, useEffect, useState } from 'react';
import { render, screen, fireEvent, waitFor, within, cleanup, configure } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import type { Exemplar } from '../../../types';
import type { WorkExemplarsResponse } from '../../../services/workApi';

configure({ asyncUtilTimeout: 3000 });

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string, d?: any) => (typeof d === 'string' ? d : k), i18n: { language: 'et' } }),
}));
vi.mock('../../ArchiveSelect', () => ({
  default: ({ value, onChange }: { value: string; onChange: (v: string) => void }) => (
    <select aria-label="holder" value={value} onChange={e => onChange(e.target.value)}>
      <option value="">—</option>
      <option value="TÜR">TÜR</option>
      <option value="EAA">EAA</option>
    </select>
  ),
}));

/** Võltsserver: eksemplaride seis + valikuline sundvastus PUT-ile. */
let server: { exemplars: Exemplar[]; pageCount: number; putStatus?: number };
const calls: { method: string; url: string; body: any }[] = [];
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status });

const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
  const method = init?.method ?? 'GET';
  const body = init?.body ? JSON.parse(String(init.body)) : null;
  calls.push({ method, url, body });
  const m = url.match(/\/works\/w1\/exemplars(?:\/([^/]+))?$/);
  if (!m) return json({});
  const sub = m[1];
  if (method === 'GET') {
    return json({ exemplars: server.exemplars, unknown_pages: [], page_numbers: {}, page_files: [],
      page_count: server.pageCount, convolutes: [], images: {} });
  }
  if (method === 'PUT') {
    if (server.putStatus) return json({ detail: 'Eksemplari ei leitud' }, server.putStatus);
    server.exemplars = server.exemplars.map(x => {
      if (x.id !== sub) {
        if (body.text_witness === true) { const nx = { ...x }; delete nx.text_witness; return nx; }
        return x;
      }
      const nx: any = { ...x };
      for (const f of ['holder', 'shelfmark', 'url', 'condition', 'binding', 'provenance', 'notes']) {
        if (f in body) { if (body[f]) nx[f] = body[f]; else delete nx[f]; }
      }
      if (body.text_witness === true) nx.text_witness = true;
      return nx;
    });
    return json(server.exemplars.find(x => x.id === sub));
  }
  return json({});
});

vi.mock('../../../utils/fetchWithTimeout', () => ({
  fetchWithTimeout: (url: string, init?: RequestInit) => fetchMock(url, init),
  getAuthHeaders: () => ({}),
}));

import { FeedbackProvider } from '../../../contexts/FeedbackContext';
import { getWorkExemplars } from '../../../services/workApi';
import ExemplarList from '../ExemplarList';
import { PAGES_KEY } from '../exemplarSequences';

const archives = { TÜR: { name: 'Tartu Ülikooli raamatukogu' }, EAA: { name: 'Rahvusarhiiv' } };

/** Leht laeb andmed ja annab need loendile (nagu ExemplarPage). */
function Harness({ userRole, isManuscript = false, initialSelected = null, onChangedSpy }: {
  userRole?: string; isManuscript?: boolean; initialSelected?: string | null; onChangedSpy?: () => void;
}) {
  const [data, setData] = useState<WorkExemplarsResponse | null>(null);
  const [selected, setSelected] = useState<string | null>(initialSelected);
  const load = useCallback(async () => { setData(await getWorkExemplars('w1', 'tok')); }, []);
  useEffect(() => { void load(); }, [load]);
  if (!data) return null;
  return (
    <ExemplarList workId="w1" authToken={userRole ? 'tok' : null} userRole={userRole} isManuscript={isManuscript}
      data={data} archives={archives} onArchiveAdded={() => {}}
      selected={selected} onSelect={setSelected}
      onChanged={async () => { onChangedSpy?.(); await load(); }} />
  );
}

const renderList = (props: React.ComponentProps<typeof Harness> = {}) => render(
  <MemoryRouter><FeedbackProvider><Harness {...props} /></FeedbackProvider></MemoryRouter>,
);

const writes = () => calls.filter(c => c.method !== 'GET');

beforeEach(() => {
  calls.length = 0;
  server = {
    pageCount: 25,
    exemplars: [
      { id: 'a1', holder: 'TÜR', source: { kind: 'migration', ref: 'TÜR' }, needs_review: true },
      { id: 'b2', holder: 'EAA', shelfmark: '1.2.3', source: { kind: 'jaanson', ref: 'Jaanson 946' } },
    ],
  };
});
afterEach(() => cleanup());

describe('ExemplarList — kirje täisvaade', () => {
  it('1. hõre kirje: lahtisel real ainult täidetud väljad', async () => {
    renderList({ userRole: 'admin', initialSelected: 'a1' });
    const open = await screen.findByTestId('exemplar-detail');
    expect(within(open).queryByText('exemplars.fields.condition')).toBeNull();
    expect(within(open).queryByText('exemplars.fields.binding')).toBeNull();
    expect(within(open).queryByText('exemplars.fields.provenance')).toBeNull();
    // Hoidja täisnimi on täidetud väli
    expect(within(open).getByText('Tartu Ülikooli raamatukogu')).toBeTruthy();
  });

  it('2. avalik lugeja: toiminguid, märki ega tehnilist allikat ei ole; viiteallikas on', async () => {
    renderList({ initialSelected: 'a1' });
    await screen.findByTestId('exemplar-detail');
    expect(screen.queryByText('exemplars.edit')).toBeNull();
    expect(screen.queryByText('exemplars.needsReview')).toBeNull();
    expect(screen.queryByText(/migration|exemplars\.sourceKind\.migration/)).toBeNull();
    expect(screen.queryByLabelText('exemplars.moveUp')).toBeNull();
    expect(screen.getByText('Jaanson 946')).toBeTruthy();
  });

  it('valitav rida: klõps kinnisel real valib eksemplari', async () => {
    renderList({ userRole: 'admin', initialSelected: 'a1' });
    await screen.findByTestId('exemplar-detail');
    fireEvent.click(screen.getByText('EAA'));
    await waitFor(() => expect(within(screen.getByTestId('exemplar-detail')).getByText('Rahvusarhiiv')).toBeTruthy());
  });
});

describe('ExemplarList — rida „Teose lehed"', () => {
  it('3. alus märkimata + lehti: rida olemas, admin näeb „Märgi alus…"', async () => {
    renderList({ userRole: 'admin' });
    const row = await screen.findByTestId('pages-row');
    expect(within(row).getByText('exemplarPage.pagesRow')).toBeTruthy();
    expect(within(row).getByText('exemplarPage.markWitness')).toBeTruthy();
  });

  it('3b. avalik näeb rida ilma nuputa', async () => {
    renderList();
    const row = await screen.findByTestId('pages-row');
    expect(within(row).queryByText('exemplarPage.markWitness')).toBeNull();
  });

  it('„Märgi alus…" → valik → sama PUT text_witness', async () => {
    renderList({ userRole: 'admin' });
    const row = await screen.findByTestId('pages-row');
    fireEvent.click(within(row).getByText('exemplarPage.markWitness'));
    fireEvent.change(screen.getByLabelText('exemplarPage.markWitness'), { target: { value: 'b2' } });
    await waitFor(() => expect(writes()[0]?.body).toEqual({ text_witness: true }));
    expect(writes()[0].url).toMatch(/\/exemplars\/b2$/);
    await waitFor(() => expect(screen.queryByTestId('pages-row')).toBeNull());
  });

  it('4. alus märgitud: rida puudub', async () => {
    server.exemplars[1].text_witness = true;
    renderList({ userRole: 'admin' });
    await screen.findByText('EAA');
    expect(screen.queryByTestId('pages-row')).toBeNull();
  });

  it('rida on valitav', async () => {
    const onSelect = vi.fn();
    const data = await getWorkExemplars('w1', null);
    render(<MemoryRouter><FeedbackProvider>
      <ExemplarList workId="w1" authToken={null} isManuscript={false} data={data} archives={archives}
        onArchiveAdded={() => {}} selected={null} onSelect={onSelect} onChanged={async () => {}} />
    </FeedbackProvider></MemoryRouter>);
    fireEvent.click(within(screen.getByTestId('pages-row')).getByText('exemplarPage.pagesRow'));
    expect(onSelect).toHaveBeenCalledWith(PAGES_KEY);
  });
});

describe('ExemplarList — toimetamine', () => {
  it('5. „Muuda" → „Köite sisu" kohe nähtav (rühmad lahti)', async () => {
    renderList({ userRole: 'admin', initialSelected: 'a1' });
    fireEvent.click(await screen.findByText('exemplars.edit'));
    expect(screen.getByLabelText('exemplars.convolute.contents')).toBeTruthy();
    expect(screen.getByLabelText('exemplars.fields.condition')).toBeTruthy();
  });

  it('6. salvestus: PUT samade väljadega mis ExemplarsSection-is', async () => {
    const onChangedSpy = vi.fn();
    renderList({ userRole: 'admin', initialSelected: 'a1', onChangedSpy });
    fireEvent.click(await screen.findByText('exemplars.edit'));
    fireEvent.change(screen.getByLabelText('exemplars.shelfmark'), { target: { value: 'R 1' } });
    fireEvent.click(screen.getByText('exemplars.saveExemplar'));
    await waitFor(() => expect(writes()).toHaveLength(1));
    const put = writes()[0];
    expect(put.method).toBe('PUT');
    expect(put.url).toMatch(/\/works\/w1\/exemplars\/a1$/);
    expect(Object.keys(put.body).sort()).toEqual(
      ['binding', 'condition', 'convolute', 'holder', 'notes', 'provenance', 'reproduction', 'shelfmark', 'url']);
    expect(put.body).toMatchObject({ holder: 'TÜR', shelfmark: 'R 1', convolute: null, reproduction: null });
    expect('needs_review' in put.body).toBe(false);
    await waitFor(() => expect(screen.queryByTestId('exemplar-editor')).toBeNull());
    expect(onChangedSpy).toHaveBeenCalled();
  });

  it('7. eksemplar kustutati teises aknas: 404 → teade, loend uuesti, vorm suletud', async () => {
    const onChangedSpy = vi.fn();
    server.putStatus = 404;
    renderList({ userRole: 'admin', initialSelected: 'a1', onChangedSpy });
    fireEvent.click(await screen.findByText('exemplars.edit'));
    fireEvent.change(screen.getByLabelText('exemplars.shelfmark'), { target: { value: 'R 1' } });
    fireEvent.click(screen.getByText('exemplars.saveExemplar'));
    await screen.findByText('Eksemplari ei leitud');
    expect(onChangedSpy).toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByTestId('exemplar-editor')).toBeNull());
  });

  it('muu viga (400): mustand jääb lahti', async () => {
    server.putStatus = 400;
    renderList({ userRole: 'admin', initialSelected: 'a1' });
    fireEvent.click(await screen.findByText('exemplars.edit'));
    fireEvent.change(screen.getByLabelText('exemplars.shelfmark'), { target: { value: 'R 1' } });
    fireEvent.click(screen.getByText('exemplars.saveExemplar'));
    await screen.findByText('Eksemplari ei leitud');
    expect(screen.getByTestId('exemplar-editor')).toBeTruthy();
  });

  it('8. käsikiri ühe eksemplariga: „Lisa eksemplar" puudub, vihje on', async () => {
    server.exemplars = [{ id: 'm1', holder: 'EAA', shelfmark: '1.2.3' }];
    renderList({ userRole: 'admin', isManuscript: true });
    await screen.findByText('EAA');
    expect(screen.queryByText('exemplars.add')).toBeNull();
    expect(screen.getByTestId('manuscript-hint')).toBeTruthy();
  });
});
