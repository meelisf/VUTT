/** @vitest-environment jsdom */
import React from 'react';
import { render, screen, cleanup, fireEvent, waitFor, act } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string, o?: Record<string, unknown>) => (o ? `${k}:${JSON.stringify(o)}` : k) }),
}));
const notify = vi.fn();
const askConfirm = vi.fn();
vi.mock('../../../contexts/FeedbackContext', () => ({ useNotify: () => notify, useConfirm: () => askConfirm }));
const guard = { isDirty: false };
vi.mock('../../../hooks/useUnsavedChangesGuard', () => ({
  useUnsavedChangesGuard: (o: { isDirty: boolean }) => { guard.isDirty = o.isDirty; return { dialogProps: { isOpen: false } }; },
}));
vi.mock('../../UnsavedChangesDialog', () => ({ default: () => null }));
const api = { patch: vi.fn(), del: vi.fn(), upload: vi.fn() };
vi.mock('../../../services/exemplarImagesService', async (orig) => ({
  ...(await orig<typeof import('../../../services/exemplarImagesService')>()),
  patchExemplarImages: (...a: unknown[]) => api.patch(...a),
  deleteExemplarImage: (...a: unknown[]) => api.del(...a),
  uploadExemplarImages: (...a: unknown[]) => api.upload(...a),
}));

import { ManifestConflictError, type ExemplarManifest } from '../../../services/exemplarImagesService';
import ExemplarImageEditor from '../ExemplarImageEditor';

const manifest: ExemplarManifest = {
  revision: 4, imports: {},
  images: [
    { id: 'img001', source: { kind: 'photo', ref: 'A' } },
    { id: 'img002', source: { kind: 'ada', ref: '10062/1', page: 2, import_id: 'q1q1q1' } },
  ],
};

afterEach(cleanup);
beforeEach(() => {
  notify.mockReset(); askConfirm.mockReset();
  api.patch.mockReset(); api.del.mockReset(); api.upload.mockReset();
});

function setup(m: ExemplarManifest = manifest) {
  const onManifest = vi.fn();
  let setM: (m: ExemplarManifest) => void = () => {};
  function Host() {
    const [cur, setCur] = React.useState(m);
    setM = setCur;
    return <ExemplarImageEditor workId="w1" exemplarId="a1b2c3" manifest={cur} authToken="tok" onManifest={onManifest} />;
  }
  const router = createMemoryRouter([{ path: '/', element: <Host /> }]);
  render(<RouterProvider router={router} />);
  return { onManifest, setManifest: (x: ExemplarManifest) => act(() => setM(x)) };
}

const rowIds = () => screen.getAllByTestId('exemplar-editor-row').map(r => r.getAttribute('data-image-id'));

describe('ExemplarImageEditor', () => {
  it('failide valik → üleslaadimine allikaga', async () => {
    api.upload.mockResolvedValue({ ...manifest, revision: 5 });
    const { onManifest } = setup();
    const file = new File(['x'], 'a.jpg', { type: 'image/jpeg' });
    fireEvent.change(screen.getByLabelText('exemplarImages.editor.uploadRef'), { target: { value: 'M. F. foto' } });
    fireEvent.change(screen.getByTestId('exemplar-upload-input'), { target: { files: [file] } });
    await waitFor(() => expect(api.upload).toHaveBeenCalled());
    expect(api.upload.mock.calls[0][2]).toEqual([file]);
    expect(api.upload.mock.calls[0][3]).toEqual({ kind: 'photo', ref: 'M. F. foto' });
    await waitFor(() => expect(onManifest).toHaveBeenCalled());
  });

  it('järjekorra muutus teeb mustandi; salvesta → PATCH revisjoniga', async () => {
    api.patch.mockResolvedValue({ ...manifest, revision: 5 });
    setup();
    expect(guard.isDirty).toBe(false);
    fireEvent.click(screen.getAllByLabelText('exemplarImages.editor.moveDown')[0]);
    expect(guard.isDirty).toBe(true);
    fireEvent.click(screen.getByText('exemplarImages.editor.save'));
    await waitFor(() => expect(api.patch).toHaveBeenCalled());
    const [, , revision, images] = api.patch.mock.calls[0];
    expect(revision).toBe(4);
    expect(images.map((i: { id: string }) => i.id)).toEqual(['img002', 'img001']);
  });

  it('impordipildil on muudetav ainult litsents', () => {
    setup();
    const rows = screen.getAllByTestId('exemplar-editor-row');
    expect(rows[1].querySelector('[aria-label="exemplarImages.editor.sourceRef"]')).toBeNull();
    expect(rows[1].querySelector('[aria-label="exemplarImages.editor.license"]')).not.toBeNull();
    expect(rows[0].querySelector('[aria-label="exemplarImages.editor.sourceRef"]')).not.toBeNull();
  });

  it('kustuta küsib kinnitust, siis DELETE', async () => {
    askConfirm.mockResolvedValue(true);
    api.del.mockResolvedValue({ ...manifest, revision: 5, images: [manifest.images[1]] });
    const { onManifest } = setup();
    fireEvent.click(screen.getAllByLabelText('exemplarImages.editor.delete')[0]);
    await waitFor(() => expect(api.del).toHaveBeenCalledWith('w1', 'a1b2c3', 'img001', 4, 'tok'));
    expect(askConfirm).toHaveBeenCalled();
    await waitFor(() => expect(onManifest).toHaveBeenCalled());
  });

  it('kinnituseta kustutust ei toimu', async () => {
    askConfirm.mockResolvedValue(false);
    setup();
    fireEvent.click(screen.getAllByLabelText('exemplarImages.editor.delete')[0]);
    await waitFor(() => expect(askConfirm).toHaveBeenCalled());
    expect(api.del).not.toHaveBeenCalled();
  });

  it('409 → hoiatus ja praegune manifest', async () => {
    const current = { ...manifest, revision: 9 };
    api.patch.mockRejectedValue(new ManifestConflictError('m', current));
    const { onManifest } = setup();
    fireEvent.click(screen.getAllByLabelText('exemplarImages.editor.moveDown')[0]);
    fireEvent.click(screen.getByText('exemplarImages.editor.save'));
    await waitFor(() => expect(notify).toHaveBeenCalledWith('exemplarImages.editor.conflict', 'warning'));
    expect(onManifest).toHaveBeenCalledWith(current);
  });

  it('salvestamata järjekord säilib, kui manifest uueneb (üleslaadimine); uus pilt lõppu', () => {
    const { setManifest } = setup();
    fireEvent.click(screen.getAllByLabelText('exemplarImages.editor.moveDown')[0]);
    expect(rowIds()).toEqual(['img002', 'img001']);
    setManifest({ ...manifest, revision: 5, images: [...manifest.images, { id: 'img003', source: { kind: 'photo' } }] });
    expect(rowIds()).toEqual(['img002', 'img001', 'img003']);
    expect(guard.isDirty).toBe(true);
  });

  it('409 järel jääb salvestamata järjekord alles, kustutatud pilt kaob', async () => {
    const three = { ...manifest, images: [...manifest.images, { id: 'img003', source: { kind: 'photo' as const } }] };
    const current = { ...three, revision: 9, images: [three.images[0], three.images[1]] };
    api.patch.mockRejectedValue(new ManifestConflictError('m', current));
    const { onManifest, setManifest } = setup(three);
    fireEvent.click(screen.getAllByLabelText('exemplarImages.editor.moveDown')[0]);   // 2,1,3
    fireEvent.click(screen.getByText('exemplarImages.editor.save'));
    await waitFor(() => expect(onManifest).toHaveBeenCalledWith(current));
    setManifest(current);
    expect(rowIds()).toEqual(['img002', 'img001']);
    expect(guard.isDirty).toBe(true);
  });
});
