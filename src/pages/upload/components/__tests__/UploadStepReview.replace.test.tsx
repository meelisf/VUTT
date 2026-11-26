/** @vitest-environment jsdom */
import { render, screen, within, cleanup } from '@testing-library/react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { MemoryRouter } from 'react-router-dom';

vi.mock('../../../../hooks/useAdminImageTicket', () => ({ useAdminImageTicket: () => null }));
vi.mock('../../../../components/UploadMetaForm', () => ({ default: () => <div data-testid="meta-form" /> }));

import UploadStepReview from '../UploadStepReview';

const base = {
  status: 'done', pollResult: { status: 'done', ready: 2 }, readyCount: 2, placeholderPages: [],
  filesWithLocalDeleted: [], uploadId: 'u1', authToken: 'tok', userRole: 'admin', collections: {},
  title: 'T', year: '1642', selectedCollection: '', fileUploading: false, ocrTimedOut: false,
  estimatedTime: null, importError: '', canImport: true, importLoading: false,
  onImport: () => {}, onReplaceImport: () => {}, t: (k: string) => k,
};

function renderReview(over: Record<string, unknown>) {
  return render(
    <MemoryRouter>
      <UploadStepReview {...(base as any)} replaceWorkId={null} replaceWorkTitle={null} {...over} />
    </MemoryRouter>,
  );
}

afterEach(cleanup);

describe('UploadStepReview — asendusrežiim', () => {
  it('uue teose import: metaandmete vorm, asenduskasti pole', () => {
    renderReview({});
    expect(screen.getByTestId('meta-form')).toBeTruthy();
    expect(screen.queryByTestId('replace-panel')).toBeNull();
    expect(screen.getByText('step3.importBtn')).toBeTruthy();
  });

  it('asendus: vormi pole (server metaandmeid ei rakenda), märkus + link teosele', () => {
    renderReview({ replaceWorkId: 'w1', replaceWorkTitle: 'Pikk pealkiri' });
    expect(screen.queryByTestId('meta-form')).toBeNull();
    const note = screen.getByTestId('replace-meta-note');
    expect(within(note).getByText('replaceWork.openWork').closest('a')?.getAttribute('href')).toBe('/work/w1');
  });

  it('asendus: pealkiri kastis, nupp ilma pealkirjata; aluse vahetusel oma tagajärjelause', () => {
    renderReview({ replaceWorkId: 'w1', replaceWorkTitle: 'Pikk pealkiri' });
    const panel = screen.getByTestId('replace-panel');
    expect(within(panel).getByText('Pikk pealkiri')).toBeTruthy();
    expect(within(panel).getByRole('button').textContent).toBe('replaceWork.replaceBtn');
    expect(within(panel).getByText('replaceWork.consequence')).toBeTruthy();
    cleanup();
    renderReview({ replaceWorkId: 'w1', replaceWorkTitle: 'P',
      pollResult: { status: 'done', ready: 2, promote: { exemplar_id: 'd3' } } });
    expect(screen.getByText('replaceWork.consequencePromote')).toBeTruthy();
  });
});
