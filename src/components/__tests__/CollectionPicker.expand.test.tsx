/** @vitest-environment jsdom */
/**
 * Tippkollektsioonid on avatud ka siis, kui kogud saabuvad pärast mount'i (#319 p1).
 *
 * `Header` monteerib valija TINGIMUSTETA (`isOpen` juhib ainult `return null`-i),
 * seega mount toimub enne, kui `CollectionContext` on kogud üle võrgu kätte
 * saanud. `useState`-i initsialiseerija jookseb täpselt üks kord — sel hetkel —
 * ja nägi tühja objekti, mistõttu laiendatud hulk jäi tühjaks ning kaks
 * suurimat kogu (1258 teost 1385-st) jäid ühe lisakliki taha.
 *
 * Test hoiab just seda järjekorda: esimene render tühjade kogudega, alles
 * teine päris andmetega.
 */
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

// --- Mockid enne mooduli importi -------------------------------------------

let kontekst: {
  collections: Record<string, { name: { et: string; en: string }; parent?: string }>;
};

vi.mock('../../contexts/CollectionContext', () => ({
  useCollection: () => ({
    selection: { kind: 'all' as const },
    setSelection: vi.fn(),
    collections: kontekst.collections,
    workSets: [],
    workSetsError: null,
    refreshWorkSets: vi.fn(),
  }),
}));

vi.mock('../../contexts/UserContext', () => ({
  useUser: () => ({ user: { username: 'toimetaja', role: 'editor', allowed_collections: [] } }),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (_k: string, d?: string) => d ?? _k, i18n: { language: 'et' } }),
}));

vi.mock('../../services/workSetService', () => ({ createWorkSet: vi.fn() }));

import CollectionPicker from '../CollectionPicker';

const KOGUD = {
  gustaviana: { name: { et: 'Academia Gustaviana', en: 'Academia Gustaviana' } },
  disputatsioonid: { name: { et: 'Disputatsioonid', en: 'Disputations' }, parent: 'gustaviana' },
};

describe('CollectionPicker — laiendatud tippkollektsioonid', () => {
  beforeEach(() => {
    kontekst = { collections: {} };
  });

  it('näitab alamkogu, kui kogud saabuvad alles pärast mount i', () => {
    const { rerender } = render(<CollectionPicker isOpen onClose={vi.fn()} />);
    // Mount tühjade kogudega — täpselt nii käitub `Header`.
    expect(screen.queryByText('Academia Gustaviana')).toBeNull();

    kontekst = { collections: KOGUD };
    rerender(<CollectionPicker isOpen onClose={vi.fn()} />);

    expect(screen.getByText('Academia Gustaviana')).toBeTruthy();
    expect(screen.getByText('Disputatsioonid')).toBeTruthy();
  });

  it('ei ava kasutaja kokkuklapitud haru uuesti', () => {
    kontekst = { collections: KOGUD };
    const { rerender } = render(<CollectionPicker isOpen onClose={vi.fn()} />);
    expect(screen.getByText('Disputatsioonid')).toBeTruthy();

    // Ainus nupp ilma tekstita tipprea ees on laiendamise lüliti.
    fireEvent.click(screen.getByText('Academia Gustaviana').closest('div')!.querySelector('button')!);
    expect(screen.queryByText('Disputatsioonid')).toBeNull();

    // Uus kontekstiväärtus (nt `refreshCollections`) ei tohi valikut tühistada.
    kontekst = { collections: { ...KOGUD } };
    rerender(<CollectionPicker isOpen onClose={vi.fn()} />);
    expect(screen.queryByText('Disputatsioonid')).toBeNull();
  });
});
