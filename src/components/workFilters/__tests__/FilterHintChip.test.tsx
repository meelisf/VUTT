/** @vitest-environment jsdom */
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (k: string) => k }) }));

import { FilterHintChip, FilterChip } from '../WorkFilterChips';

describe('FilterHintChip', () => {
  it('kollane punktiir, liik, silt ja loendur; klikk = onAccept', () => {
    const onAccept = vi.fn();
    render(<FilterHintChip kind="Žanr" label="Põhikiri" count={7} onAccept={onAccept} />);
    const btn = screen.getByRole('button', { name: 'dashboard:filterHints.addFilter: Žanr Põhikiri' });
    expect(btn.className).toContain('border-dashed');
    expect(btn.className).toContain('border-amber-400');
    expect(btn.textContent).toContain('(7)');
    fireEvent.click(btn);
    expect(onAccept).toHaveBeenCalledOnce();
  });
});

describe('FilterChip highlight', () => {
  it('highlight lisab sähvatuse animatsiooni', () => {
    const { container } = render(<FilterChip kind="Žanr" label="Põhikiri" onRemove={() => {}} highlight />);
    expect((container.firstChild as HTMLElement).className).toContain('animate-hint-flash');
  });
});
