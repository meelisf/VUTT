/** @vitest-environment jsdom */
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string, o?: Record<string, unknown>) => (o ? `${k}:${JSON.stringify(o)}` : k) }),
}));
const notify = vi.fn();
vi.mock('../../../contexts/FeedbackContext', () => ({ useNotify: () => notify }));
const startAdaImport = vi.fn();
const fetchAdaImportStatus = vi.fn();
vi.mock('../../../services/exemplarImagesService', async (orig) => ({
  ...(await orig<typeof import('../../../services/exemplarImagesService')>()),
  startAdaImport: (...a: unknown[]) => startAdaImport(...a),
  fetchAdaImportStatus: (...a: unknown[]) => fetchAdaImportStatus(...a),
}));

import { ApiError } from '../../../services/apiClient';
import AdaImportDialog from '../AdaImportDialog';

afterEach(cleanup);
beforeEach(() => { notify.mockReset(); startAdaImport.mockReset(); fetchAdaImportStatus.mockReset(); });

function setup() {
  const onPublished = vi.fn();
  const onClose = vi.fn();
  render(<AdaImportDialog workId="w1" exemplarId="a1b2c3" authToken="tok" pollMs={1}
    onPublished={onPublished} onClose={onClose} />);
  fireEvent.change(screen.getByLabelText('exemplarImages.ada.handle'), { target: { value: '10062/14332' } });
  fireEvent.change(screen.getByLabelText('exemplarImages.ada.from'), { target: { value: '3' } });
  fireEvent.change(screen.getByLabelText('exemplarImages.ada.to'), { target: { value: '7' } });
  fireEvent.click(screen.getByText('exemplarImages.ada.start'));
  return { onPublished, onClose };
}

describe('AdaImportDialog', () => {
  it('käivitab vahemikuga ja pollib kuni published', async () => {
    startAdaImport.mockResolvedValue({ import_id: 'q1q1q1' });
    fetchAdaImportStatus
      .mockResolvedValueOnce({ state: 'rendering', pages_total: 5, pages_done: 2 })
      .mockResolvedValueOnce({ state: 'published' });
    const { onPublished } = setup();
    await waitFor(() => expect(onPublished).toHaveBeenCalled());
    expect(startAdaImport).toHaveBeenCalledWith('w1', 'a1b2c3', '10062/14332', 3, 7, 'tok');
  });

  it('error → teade', async () => {
    startAdaImport.mockResolvedValue({ import_id: 'q1q1q1' });
    fetchAdaImportStatus.mockResolvedValue({ state: 'error', error: 'Lehevahemik ei mahu' });
    const { onPublished } = setup();
    await waitFor(() => expect(notify).toHaveBeenCalledWith(expect.stringContaining('Lehevahemik'), 'error'));
    expect(onPublished).not.toHaveBeenCalled();
  });

  it('409 → import juba käib', async () => {
    startAdaImport.mockRejectedValue(new ApiError('x', 409, { detail: 'käib' }));
    setup();
    await waitFor(() => expect(notify).toHaveBeenCalledWith('exemplarImages.ada.already', 'warning'));
  });
});
