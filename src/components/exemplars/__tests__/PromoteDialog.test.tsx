/** @vitest-environment jsdom */
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';

// ADR 0089 p 6: „Tee transkriptsiooni aluseks" dialoog.
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string, o?: Record<string, unknown>) => (o ? `${k}:${JSON.stringify(o)}` : k) }),
}));
const notify = vi.fn();
vi.mock('../../../contexts/FeedbackContext', () => ({ useNotify: () => notify }));
const api = vi.hoisted(() => ({
  fetchPromotePreview: vi.fn(), startPromote: vi.fn(), confirmPromote: vi.fn(),
}));
vi.mock('../../../services/promoteApi', async (orig) => ({
  ...(await orig<typeof import('../../../services/promoteApi')>()),
  fetchPromotePreview: (...a: unknown[]) => api.fetchPromotePreview(...a),
  startPromote: (...a: unknown[]) => api.startPromote(...a),
  confirmPromote: (...a: unknown[]) => api.confirmPromote(...a),
}));

import { ApiError } from '../../../services/apiClient';
import PromoteDialog from '../PromoteDialog';

const EX = [{ id: 'tttttt', holder: 'TÜR' }, { id: 'nnnnnn', holder: 'Uppsala UB', shelfmark: 'X 1' }];
const base = {
  pages: [{ stem: 's1', page: 1, status: 'Toores', origin: 'tttttt', edited: false, fingerprint: 'a' }],
  edited: {}, unknown: [], unstorable: [], images: 3, witness: 'tttttt', parts: 0,
};

afterEach(cleanup);
beforeEach(() => { notify.mockReset(); Object.values(api).forEach(f => f.mockReset()); });

function setup(props: Partial<React.ComponentProps<typeof PromoteDialog>> = {}) {
  const onStarted = vi.fn();
  const onConfirmed = vi.fn();
  render(<PromoteDialog workId="w1" exemplarId="nnnnnn" exemplars={EX} authToken="tok" mode="start"
    onClose={vi.fn()} onStarted={onStarted} onConfirmed={onConfirmed} {...props} />);
  return { onStarted, onConfirmed };
}

const primary = () => screen.getByRole('button', { name: /exemplarPage.promote.(start|confirm)$/ });

describe('PromoteDialog', () => {
  it('toimetatud lehed: nupp keelatud ilma kinnitusruuduta', async () => {
    api.fetchPromotePreview.mockResolvedValue({ ...base, edited: { s1: 'a' },
      pages: [{ ...base.pages[0], status: 'Parandatud', edited: true }] });
    setup();
    await screen.findByText(/exemplarPage.promote.editedWarning/);
    expect(primary()).toHaveProperty('disabled', true);
    fireEvent.click(screen.getByRole('checkbox'));
    expect(primary()).toHaveProperty('disabled', false);
  });

  it('teadmata lehed nõuavad sihti', async () => {
    api.fetchPromotePreview.mockResolvedValue({ ...base, unknown: ['s1'],
      pages: [{ ...base.pages[0], origin: null }] });
    setup();
    await screen.findByLabelText('exemplarPage.promote.unknownTarget');
    expect(primary()).toHaveProperty('disabled', true);
    fireEvent.change(screen.getByLabelText('exemplarPage.promote.unknownTarget'), { target: { value: 'tttttt' } });
    expect(primary()).toHaveProperty('disabled', false);
  });

  it('salvestamatu vana leht: alustada ei saa', async () => {
    api.fetchPromotePreview.mockResolvedValue({ ...base, unstorable: [{ stem: 's1', reason: 'liiga suur' }] });
    setup();
    await screen.findByText(/liiga suur/);
    expect(primary()).toHaveProperty('disabled', true);
  });

  it('edu: kutsub onStarted upload_id-ga ja saadab kinnituse', async () => {
    api.fetchPromotePreview.mockResolvedValue(base);
    api.startPromote.mockResolvedValue('u9');
    const { onStarted } = setup();
    await waitFor(() => expect(primary()).toHaveProperty('disabled', false));
    fireEvent.click(primary());
    await waitFor(() => expect(onStarted).toHaveBeenCalledWith('u9'));
    expect(api.startPromote).toHaveBeenCalledWith('w1', 'nnnnnn', { unknown_target: null, confirmed_edited: {} }, 'tok');
  });

  it('409 edited_pages_changed: näitab uut seisu ja nõuab uut kinnitust', async () => {
    api.fetchPromotePreview.mockResolvedValue(base);
    const uus = { ...base, edited: { s1: 'b' }, pages: [{ ...base.pages[0], status: 'Töös', edited: true }] };
    api.startPromote.mockRejectedValue(new ApiError('409', 409, { detail: { code: 'edited_pages_changed', detail: uus } }));
    setup();
    await waitFor(() => expect(primary()).toHaveProperty('disabled', false));
    fireEvent.click(primary());
    await screen.findByText(/exemplarPage.promote.editedWarning/);
    expect(primary()).toHaveProperty('disabled', true);
  });

  it('kinnitusrežiim (viisard): kasutab antud eelvaadet ja kutsub confirmPromote', async () => {
    api.confirmPromote.mockResolvedValue(undefined);
    const { onConfirmed } = setup({ mode: 'confirm', uploadId: 'u9', initialPreview: base });
    fireEvent.click(primary());
    await waitFor(() => expect(onConfirmed).toHaveBeenCalled());
    expect(api.fetchPromotePreview).not.toHaveBeenCalled();
    expect(api.confirmPromote).toHaveBeenCalledWith('u9', { unknown_target: null, confirmed_edited: {} }, 'tok');
  });
});
