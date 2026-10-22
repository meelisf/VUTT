/** @vitest-environment jsdom */
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string, d?: any) => (typeof d === 'string' ? d : k), i18n: { language: 'et' } }),
}));
// Raskemad alamkomponendid ei puutu nupu olekusse
vi.mock('../EntityPicker', () => ({ default: () => null }));
vi.mock('../CollectionTargetSelect', () => ({ default: () => null }));
vi.mock('../creators/CreatorsEditor', () => ({ default: () => null }));
vi.mock('../ArchiveSelect', () => ({ default: () => null }));
vi.mock('../TitleVariantsFields', () => ({ default: () => null }));
vi.mock('../WorkDatingInput', () => ({ default: () => null }));
vi.mock('../../services/collectionService', () => ({ getVocabularies: vi.fn(async () => null) }));

const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
  if (url.endsWith('/meta') && !init?.method) {
    return { ok: true, json: async () => ({ meta: { title: 'Trost-Zeilen' } }) } as any;
  }
  return { ok: true, json: async () => ({}) } as any;
});
vi.mock('../../utils/fetchWithTimeout', () => ({
  fetchWithTimeout: (url: string, init?: RequestInit) => fetchMock(url, init),
  getAuthHeaders: () => ({}),
}));

import UploadMetaForm from '../UploadMetaForm';

describe('UploadMetaForm — salvestusnupu värv', () => {
  it('oranž ainult salvestamata muudatusel', async () => {
    render(<UploadMetaForm uploadId="u1" authToken="t" collections={{}} />);
    const titleInput = await screen.findByDisplayValue('Trost-Zeilen');
    const button = () => screen.getByText('step3.metaSaveBtn').closest('button')!;
    expect(button().className).toContain('bg-primary-600');

    fireEvent.change(titleInput, { target: { value: 'Trost-Zeilen 2' } });
    expect(button().className).toContain('bg-amber-500');

    fireEvent.click(button());
    await waitFor(() => expect(screen.getByText('step3.metaSaved').closest('button')!.className).toContain('bg-primary-600'));
  });
});
