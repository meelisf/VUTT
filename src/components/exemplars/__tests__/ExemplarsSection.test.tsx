/** @vitest-environment jsdom */
import React from 'react';
import { render, screen, fireEvent, waitFor, within, cleanup, configure } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mitme järjestikuse päringuga voog: vaikimisi 1 s jääb täiskomplekti koormuse all väheks.
configure({ asyncUtilTimeout: 3000 });
import type { Exemplar } from '../../../types';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string, d?: any) => (typeof d === 'string' ? d : k), i18n: { language: 'et' } }),
}));
// Hoidja valik: lihtne select (ArchiveSelect-i enda käitumine ei ole siin testi all)
vi.mock('../../ArchiveSelect', () => ({
  default: ({ value, onChange }: { value: string; onChange: (v: string) => void }) => (
    <select aria-label="holder" value={value} onChange={e => onChange(e.target.value)}>
      <option value="">—</option>
      <option value="TÜR">TÜR</option>
      <option value="EAA">EAA</option>
    </select>
  ),
}));

/** Väike võltsserver: hoiab eksemplaride seisu ja jõustab tunnistaja reegli nagu päris server. */
let server: { exemplars: Exemplar[]; manuscript: boolean };
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
    return json({ exemplars: server.exemplars, unknown_pages: [], page_numbers: {}, page_count: 3, convolutes: [] });
  }
  if (method === 'POST' && sub === 'order') {
    const byId = Object.fromEntries(server.exemplars.map(x => [x.id, x]));
    server.exemplars = body.ids.map((id: string) => byId[id]);
    return json({ exemplars: server.exemplars });
  }
  if (method === 'POST') {
    if (server.manuscript && server.exemplars.length >= 1) {
      return json({ detail: 'Käsikirjal on üks eksemplar — kasuta variandiseost' }, 400);
    }
    const x: Exemplar = { id: `n${server.exemplars.length}`, holder: body.holder, source: { kind: 'manual' } };
    if (body.shelfmark) x.shelfmark = body.shelfmark;
    server.exemplars = [...server.exemplars, x];
    return json(x, 201);
  }
  if (method === 'PUT') {
    server.exemplars = server.exemplars.map(x => {
      let nx: Exemplar = { ...x };
      if (x.id === sub) {
        for (const f of ['holder', 'shelfmark', 'url'] as const) {
          if (f in body) { if (body[f]) (nx as any)[f] = body[f]; else delete (nx as any)[f]; }
        }
        if ('convolute' in body) { if (body.convolute) nx.convolute = body.convolute; else delete nx.convolute; }
        if (body.needs_review === false) delete nx.needs_review;
        if (body.text_witness === true) nx.text_witness = true;
        if (body.text_witness === false) delete nx.text_witness;
      } else if (body.text_witness === true) {
        nx = { ...nx }; delete nx.text_witness;
      }
      return nx;
    });
    return json(server.exemplars.find(x => x.id === sub));
  }
  if (method === 'DELETE') {
    server.exemplars = server.exemplars.filter(x => x.id !== sub);
    return new Response(null, { status: 204 });
  }
  return json({});
});

vi.mock('../../../utils/fetchWithTimeout', () => ({
  fetchWithTimeout: (url: string, init?: RequestInit) => fetchMock(url, init),
  getAuthHeaders: () => ({}),
}));

import { FeedbackProvider } from '../../../contexts/FeedbackContext';
import ExemplarsSection from '../ExemplarsSection';

const archives = { TÜR: { name: 'Tartu Ülikooli raamatukogu' }, EAA: { name: 'Rahvusarhiiv' } };

function renderSection(props: Partial<React.ComponentProps<typeof ExemplarsSection>> = {}) {
  return render(
    <FeedbackProvider>
      <ExemplarsSection workId="w1" authToken="tok" userRole="admin" isManuscript={false}
        archives={archives} onArchiveAdded={() => {}} {...props} />
    </FeedbackProvider>,
  );
}

const writes = () => calls.filter(c => c.method !== 'GET');

beforeEach(() => {
  calls.length = 0;
  server = {
    manuscript: false,
    exemplars: [
      { id: 'a1', holder: 'TÜR', shelfmark: 'R Est.B-954', needs_review: true, source: { kind: 'migration', ref: 'TÜR: R Est.B-954' } },
      { id: 'b2', holder: 'EAA', shelfmark: '1.2.3', text_witness: true },
    ],
  };
});
afterEach(() => cleanup());

describe('ExemplarsSection — admin', () => {
  it('muudab kohaviita, salvestab kohe PUT-iga ja näitab serveri seisu', async () => {
    const onChanged = vi.fn();
    const onDirtyChange = vi.fn();
    renderSection({ onChanged, onDirtyChange });
    await screen.findByText('· R Est.B-954');
    expect(screen.getByText('exemplars.needsReview')).toBeTruthy();
    expect(screen.getByText(/exemplars\.source: migration/)).toBeTruthy();

    fireEvent.click(screen.getAllByLabelText('exemplars.edit')[0]);
    const input = screen.getByLabelText('exemplars.shelfmark');
    fireEvent.change(input, { target: { value: 'R Est.B-954 (I)' } });
    expect(onDirtyChange).toHaveBeenLastCalledWith(true);

    fireEvent.click(screen.getByText('exemplars.saveExemplar'));
    await screen.findByText('· R Est.B-954 (I)');
    const put = writes()[0];
    expect(put.method).toBe('PUT');
    expect(put.url).toMatch(/\/works\/w1\/exemplars\/a1$/);
    expect(put.body.shelfmark).toBe('R Est.B-954 (I)');
    // Tavaline salvestus lippu EI eemalda
    expect('needs_review' in put.body).toBe(false);
    expect(screen.getByText('exemplars.needsReview')).toBeTruthy();
    expect(onChanged).toHaveBeenCalled();
    expect(onDirtyChange).toHaveBeenLastCalledWith(false);
  });

  it('lipu mahavõtt ainult selgesõnalise nupuga', async () => {
    renderSection();
    fireEvent.click(await screen.findByText('exemplars.markReviewed'));
    await waitFor(() => expect(screen.queryByText('exemplars.needsReview')).toBeNull());
    expect(writes()[0].body).toEqual({ needs_review: false });
  });

  it('tunnistaja vahetus: kinnitus, PUT text_witness ja märge serveri vastusest', async () => {
    renderSection();
    await screen.findByText('· R Est.B-954');
    fireEvent.click(screen.getByText('exemplars.markWitness'));
    const dialog = await screen.findByText('exemplars.witnessConfirm');
    fireEvent.click(within(dialog.closest('[role="dialog"], .fixed') as HTMLElement).getByText('buttons.confirm'));
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0].body).toEqual({ text_witness: true });
    // Server võttis märke b2-lt — klient näitab seda alles pärast uut laadimist
    await waitFor(() => {
      const items = screen.getAllByRole('listitem');
      expect(within(items[0]).queryByText('exemplars.witness')).toBeTruthy();
      expect(within(items[1]).queryByText('exemplars.witness')).toBeNull();
    });
  });

  it('lisab uue eksemplari POST-iga', async () => {
    renderSection();
    fireEvent.click(await screen.findByText('exemplars.add'));
    fireEvent.change(screen.getByLabelText('holder'), { target: { value: 'EAA' } });
    fireEvent.change(screen.getByLabelText('exemplars.shelfmark'), { target: { value: '995.1.7' } });
    fireEvent.click(screen.getByText('exemplars.saveExemplar'));
    await screen.findByText('· 995.1.7');
    const post = writes()[0];
    expect(post.method).toBe('POST');
    expect(post.url).toMatch(/\/works\/w1\/exemplars$/);
    expect(post.body).toMatchObject({ holder: 'EAA', shelfmark: '995.1.7' });
  });

  it('kustutab kinnituse järel ja järjestab üles/alla', async () => {
    renderSection();
    await screen.findByText('· R Est.B-954');
    fireEvent.click(screen.getAllByLabelText('exemplars.moveDown')[0]);
    await waitFor(() => expect(writes()[0]?.body).toEqual({ ids: ['b2', 'a1'] }));

    await waitFor(() => expect(screen.getAllByRole('listitem')[0].textContent).toContain('1.2.3'));
    fireEvent.click(screen.getAllByLabelText('exemplars.delete')[0]);
    const msg = await screen.findByText('exemplars.deleteConfirm');
    const modal = msg.closest('.fixed') as HTMLElement;
    fireEvent.click(within(modal).getByText('exemplars.delete'));
    await waitFor(() => expect(screen.getAllByRole('listitem')).toHaveLength(1));
    expect(writes()[1].method).toBe('DELETE');
    expect(writes()[1].url).toMatch(/\/exemplars\/b2$/);
  });

  it('serveri 400 põhjendus jõuab teatesse', async () => {
    server.manuscript = true;  // server keelab, kuigi klient arvab, et tegu on trükisega
    renderSection();
    fireEvent.click(await screen.findByText('exemplars.add'));
    fireEvent.change(screen.getByLabelText('holder'), { target: { value: 'EAA' } });
    fireEvent.click(screen.getByText('exemplars.saveExemplar'));
    await screen.findByText('Käsikirjal on üks eksemplar — kasuta variandiseost');
    // Mustand jääb lahti, et kasutaja ei kaotaks sisestatut
    expect(screen.getByTestId('exemplar-editor')).toBeTruthy();
  });
});

describe('ExemplarsSection — käsikiri', () => {
  it('ühe eksemplariga käsikirjal "Lisa" puudub ja vihje suunab variandiseose juurde', async () => {
    server.exemplars = [{ id: 'm1', holder: 'EAA', shelfmark: '1.2.3' }];
    renderSection({ isManuscript: true });
    await screen.findByText('· 1.2.3');
    expect(screen.queryByText('exemplars.add')).toBeNull();
    expect(screen.getByTestId('manuscript-hint').textContent).toBe('exemplars.manuscriptOne');
  });

  it('eksemplarita käsikirjale saab ühe lisada', async () => {
    server.exemplars = [];
    renderSection({ isManuscript: true });
    expect(await screen.findByText('exemplars.add')).toBeTruthy();
  });
});

describe('ExemplarsSection — mitteadmin', () => {
  it('näeb ainult lugemiseks loendit', async () => {
    renderSection({ userRole: 'editor' });
    await screen.findByText('· R Est.B-954');
    expect(screen.queryByLabelText('exemplars.edit')).toBeNull();
    expect(screen.queryByText('exemplars.add')).toBeNull();
    expect(screen.queryByText('exemplars.markWitness')).toBeNull();
    expect(screen.queryByText(/exemplars\.source:/)).toBeNull();
  });
});

describe('ExemplarsSection — konvoluut (#702)', () => {
  it('märgib konvoluudi: PUT kannab kohaviita, kohta, arvu ja sisukorda; kokkuvõte loendis', async () => {
    renderSection();
    await screen.findByText('· R Est.B-954');
    fireEvent.click(screen.getAllByLabelText('exemplars.edit')[0]);
    fireEvent.click(screen.getByText('exemplars.convolute.toggle'));
    fireEvent.change(screen.getByLabelText('exemplars.convolute.reference'), { target: { value: 'R Est.B-954' } });
    fireEvent.change(screen.getByLabelText('exemplars.convolute.position'), { target: { value: '0' } });
    fireEvent.change(screen.getByLabelText('exemplars.convolute.total'), { target: { value: '13' } });
    fireEvent.change(screen.getByLabelText('exemplars.convolute.contents'), { target: { value: 'Fischer; Personalia' } });
    fireEvent.click(screen.getByText('exemplars.saveExemplar'));
    await screen.findByTestId('convolute-summary');
    expect(writes()[0].body.convolute).toEqual({ reference: 'R Est.B-954', position: 0, total: 13, contents: 'Fischer; Personalia' });
    expect(screen.getByTestId('convolute-summary').textContent).toContain('common:convolute.main');
  });

  it('kõigi konvoluudiväljade tühjendamine eemaldab märke (convolute: null)', async () => {
    server.exemplars[0].convolute = { reference: 'R Est.B-954', position: 1 };
    renderSection();
    await screen.findByTestId('convolute-summary');
    fireEvent.click(screen.getAllByLabelText('exemplars.edit')[0]);
    // Olemasoleva konvoluudiga on väljad kohe lahti
    fireEvent.change(screen.getByLabelText('exemplars.convolute.reference'), { target: { value: '' } });
    fireEvent.change(screen.getByLabelText('exemplars.convolute.position'), { target: { value: '' } });
    fireEvent.click(screen.getByText('exemplars.saveExemplar'));
    await waitFor(() => expect(screen.queryByTestId('convolute-summary')).toBeNull());
    expect(writes()[0].body.convolute).toBeNull();
  });

  it('kohaviiteta, aga täidetud sisukord: hoiatus, märget ei eemaldata', async () => {
    server.exemplars[0].convolute = { reference: 'R Est.B-954', contents: 'Fischer' };
    renderSection();
    await screen.findByTestId('convolute-summary');
    fireEvent.click(screen.getAllByLabelText('exemplars.edit')[0]);
    fireEvent.change(screen.getByLabelText('exemplars.convolute.reference'), { target: { value: '' } });
    fireEvent.click(screen.getByText('exemplars.saveExemplar'));
    await screen.findByText('exemplars.convolute.referenceRequired');
    expect(writes()).toHaveLength(0);
  });

  it('mittetäisarvuline koht: hoiatus, päringut ei tehta', async () => {
    renderSection();
    await screen.findByText('· R Est.B-954');
    fireEvent.click(screen.getAllByLabelText('exemplars.edit')[0]);
    fireEvent.click(screen.getByText('exemplars.convolute.toggle'));
    fireEvent.change(screen.getByLabelText('exemplars.convolute.reference'), { target: { value: 'R 1' } });
    fireEvent.change(screen.getByLabelText('exemplars.convolute.position'), { target: { value: '1a' } });
    fireEvent.click(screen.getByText('exemplars.saveExemplar'));
    await screen.findByText('exemplars.convolute.countInvalid');
    expect(writes()).toHaveLength(0);
  });
});
