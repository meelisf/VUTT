/** @vitest-environment jsdom */
import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import '../../pages/manage/parts/__tests__/testI18n';
import UnsavedChangesDialog from '../UnsavedChangesDialog';

describe('UnsavedChangesDialog kiht', () => {
  it('on hõljuvate paneelide (z-[1300]) ja päise (z-[1200]) kohal', () => {
    render(<UnsavedChangesDialog open saving={false} saveFailed={false} onSaveAndContinue={() => {}} onDiscard={() => {}} onStay={() => {}} />);
    const overlay = screen.getByRole('alertdialog').parentElement!;
    expect(overlay.className).toContain('z-[1400]');
  });
});
