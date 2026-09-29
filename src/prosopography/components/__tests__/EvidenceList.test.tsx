/** @vitest-environment jsdom */
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import '../relations/__tests__/testI18n';
import EvidenceList from '../EvidenceList';

const evidence = [
  { source_kind: 'vutt_page', work_id: 'w1', page: 5 },
  { source_kind: 'literature', source_id: 'ABC', citation: 'Donecker 2012, X', locator: 'lk 3' },
];

describe('EvidenceList', () => {
  it('eemaldamisnupp annab tõendi indeksi', () => {
    const onRemove = vi.fn();
    render(<MemoryRouter><EvidenceList evidence={evidence} titleOf={() => 'Teos'} onRemove={onRemove} /></MemoryRouter>);
    fireEvent.click(screen.getAllByRole('button', { name: 'Eemalda tõend' })[1]);
    expect(onRemove).toHaveBeenCalledWith(1);
  });

  it('ilma onRemove-ta nuppe pole', () => {
    render(<MemoryRouter><EvidenceList evidence={evidence} titleOf={() => 'Teos'} /></MemoryRouter>);
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.getByRole('link', { name: 'Teos' }).getAttribute('href')).toBe('/work/w1/5');
  });
});
