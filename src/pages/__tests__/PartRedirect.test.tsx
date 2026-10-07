/** @vitest-environment jsdom */
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import '../manage/parts/__tests__/testI18n';

const api = vi.hoisted(() => ({ result: null as unknown, fail: false, calls: [] as (string | null)[] }));
vi.mock('../../services/workPartsApi', () => ({
  getPartsToc: vi.fn(async (_w: string, token: string | null) => {
    api.calls.push(token);
    if (api.fail) throw new Error('403');
    return api.result;
  }),
}));
const auth = vi.hoisted(() => ({ isLoading: false }));
vi.mock('../../contexts/UserContext', () => ({
  useUser: () => ({ authToken: 'tok', isLoading: auth.isLoading }),
}));
vi.mock('../NotFound', () => ({ default: () => <div>404</div> }));

import PartRedirect from '../PartRedirect';

const Where = () => { const l = useLocation(); return <div>at:{l.pathname}{l.search}</div>; };
const renderAt = (url: string) => render(
  <MemoryRouter initialEntries={[url]}>
    <Routes>
      <Route path="/work/:workId/part/:partId" element={<PartRedirect />} />
      <Route path="/work/:workId/:pageNum?" element={<Where />} />
    </Routes>
  </MemoryRouter>,
);

describe('PartRedirect (#526)', () => {
  beforeEach(() => {
    api.fail = false; api.calls = []; auth.isLoading = false;
    api.result = {
      parts: [{ id: 'dq', kind: 'letter', pages: ['s4', 's3'], creators: [], attached_to: null, needs_review: false }],
      pageNumbers: { s3: 3, s4: 4 },
    };
  });

  it('suunab osa esimesele lehele koos ?part=', async () => {
    renderAt('/work/ms169i/part/dq');
    expect(await screen.findByText('at:/work/ms169i/3?part=dq')).toBeTruthy();
    expect(api.calls).toEqual(['tok']);
  });

  it('teoses puuduv osa → 404, mitte teose algus', async () => {
    renderAt('/work/ms169i/part/xx');
    expect(await screen.findByText('404')).toBeTruthy();
  });

  it('lugemistõrge (ligipääs) → teose leht, töölaud näitab olukorra', async () => {
    api.fail = true;
    renderAt('/work/ms169i/part/dq');
    expect(await screen.findByText('at:/work/ms169i')).toBeTruthy();
  });

  it('ei päri enne, kui sessioon on laetud', () => {
    auth.isLoading = true;
    renderAt('/work/ms169i/part/dq');
    expect(api.calls).toEqual([]);
  });
});
