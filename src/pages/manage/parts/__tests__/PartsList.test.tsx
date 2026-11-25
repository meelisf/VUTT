/** @vitest-environment jsdom */
import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import './testI18n';
import PartsList from '../PartsList';
import type { WorkPart } from '../../../../services/workPartsApi';

// ADR 0089 p 5: kogu lehestiku asenduse järel on osa leheviited nullitud ja vana seis vihjena.
const part = (extra: Partial<WorkPart>): WorkPart => ({
  id: 'p1', kind: 'letter', pages: [], creators: [], attached_to: null, needs_review: true, title: 'Kiri',
  ...extra,
});

describe('PartsList — asenduse-eelne vihje', () => {
  it('näitab vana lehestikku vahemikena', () => {
    render(<PartsList parts={[part({ pages_before_replace: { at: '2026-11-25', page_numbers: [3, 4, 5, 7] } })]}
      pageNums={new Map()} activeId={null} onSelect={() => {}} />);
    expect(screen.getByText(/3–5, 7/)).toBeTruthy();
  });
  it('vihjeta osa: ainult ülevaatuse märge', () => {
    render(<PartsList parts={[part({})]} pageNums={new Map()} activeId={null} onSelect={() => {}} />);
    expect(screen.queryByText(/3–5/)).toBeNull();
  });
});
