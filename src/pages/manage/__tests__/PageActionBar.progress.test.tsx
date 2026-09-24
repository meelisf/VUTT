/** @vitest-environment jsdom */
/**
 * Pakk-rakendus võib kesta minuteid — riba peab näitama, et töö käib (#431).
 */
import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import PageActionBar, { PageActionBarProps } from '../PageActionBar';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (k: string, o?: Record<string, unknown>) => (o && 'done' in o ? `${k}:${o.done}/${o.total}` : k),
  }),
}));

const base: PageActionBarProps = {
  selectedCount: 0, onClearSelection: vi.fn(), moveTarget: '', setMoveTarget: vi.fn(),
  moveCanApply: false, moveHintText: null, onMove: vi.fn(), actionsDisabled: false,
  actionsDisabledTitle: '', onReocrClick: vi.fn(), batchProvider: 'loss', batchConfirm: false,
  selectedWithTextCount: 0, onBatchGo: vi.fn(), onBatchCancel: vi.fn(), batchError: null,
  onDeleteClick: vi.fn(), bulkDeleteConfirm: false, bulkDeleting: false, onBulkDeleteGo: vi.fn(),
  onBulkDeleteCancel: vi.fn(), bulkDeleteError: null, hasReorderChanges: false, changedCount: 0,
  reorderSaving: false, onReorderSave: vi.fn(), onDiscardReorder: vi.fn(),
  pageOpsCount: 0, pageOpsDisabled: false, onSplitSelected: vi.fn(), onNoSplitSelected: vi.fn(),
  onRotateSelected: vi.fn(), splitPercent: '50', setSplitPercent: vi.fn(), pageOpsSaving: false,
  pageOpsProgress: null, pageOpsError: null, onApplyPageOps: vi.fn(), onDiscardPageOps: vi.fn(),
};

describe('PageActionBar edenemine', () => {
  it('tööta ja valikuta riba ei ole', () => {
    const { container } = render(<PageActionBar {...base} />);
    expect(container.firstChild).toBeNull();
  });

  it('käiv töö: riba nähtav ka ilma ootel kirjeteta (leht avati keset tööd)', () => {
    render(<PageActionBar {...base} pageOpsSaving pageOpsProgress={{ done: 12, total: 65 }} />);
    expect(screen.getByTestId('page-ops-progress').textContent).toContain('manage.pageOps.progress:12/65');
    expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('18');
    expect(screen.queryByTestId('page-ops-apply')).toBeNull();
  });

  it('ootel kirjed ilma tööta: kokkuvõte ja „Rakenda", riba ei ole', () => {
    render(<PageActionBar {...base} pageOpsCount={3} />);
    expect(screen.getByTestId('page-ops-apply')).toBeTruthy();
    expect(screen.queryByTestId('page-ops-progress')).toBeNull();
  });
});
