import { describe, it, expect } from 'vitest';
import { selectionDisplay } from '../selectionDisplay';
import { Collections } from '../../services/collectionService';
import { WorkSetSummary } from '../../services/workSetService';

const COLLECTIONS = {
  klingeriana: { name: { et: 'Klingeriana', en: 'Klingeriana' } },
} as unknown as Collections;

const SETS: WorkSetSummary[] = [
  { id: 'ws_8y7q1j', name: { et: 'Fischer + matus', en: 'Fischer + funeral' },
    visibility: 'members', status: 'active', revision: 1, can_manage: false },
];

describe('selectionDisplay', () => {
  it('kõik teosed', () => {
    expect(selectionDisplay({ kind: 'all' }, COLLECTIONS, SETS, 'et'))
      .toEqual({ kind: 'all' });
  });

  it('püsikogu kannab nime', () => {
    expect(selectionDisplay({ kind: 'collection', id: 'klingeriana' }, COLLECTIONS, SETS, 'et'))
      .toEqual({ kind: 'collection', id: 'klingeriana', name: 'Klingeriana' });
  });

  it('töökollektsioon EI OLE „kõik teosed" — #354 regressioon Headeris', () => {
    // Sümptom tootmises: ?set=ws_8y7q1j näitas päises „Kõik tööd", sest
    // `selectedCollection` on töökollektsiooni ajal null ja null tähendab
    // juba „kõik teosed". Kaks olekut kollapseerusid üheks väärtuseks.
    const d = selectionDisplay({ kind: 'work_set', id: 'ws_8y7q1j' }, COLLECTIONS, SETS, 'et');
    expect(d.kind).toBe('work_set');
    expect(d).toEqual({ kind: 'work_set', id: 'ws_8y7q1j', name: 'Fischer + matus' });
  });

  it('tundmatu töökollektsioon annab nime asemel null, MITTE „kõik teosed"', () => {
    // Ligipääs kadus või kogu kustutati: kuvand peab ütlema „ei leitud",
    // mitte vaikselt terve korpuse peale langema.
    expect(selectionDisplay({ kind: 'work_set', id: 'ws_puudub' }, COLLECTIONS, [], 'et'))
      .toEqual({ kind: 'work_set', id: 'ws_puudub', name: null });
  });

  it('arhiveeritud kogu nimi kuvatakse ikka — valik on ju aktiivne', () => {
    const arhiiv = [{ ...SETS[0], status: 'archived' as const }];
    expect(selectionDisplay({ kind: 'work_set', id: 'ws_8y7q1j' }, COLLECTIONS, arhiiv, 'et'))
      .toEqual({ kind: 'work_set', id: 'ws_8y7q1j', name: 'Fischer + matus' });
  });

  it('keelevalik: en nimi, kui olemas', () => {
    expect(selectionDisplay({ kind: 'work_set', id: 'ws_8y7q1j' }, COLLECTIONS, SETS, 'en'))
      .toEqual({ kind: 'work_set', id: 'ws_8y7q1j', name: 'Fischer + funeral' });
  });

  it('tundmatu püsikogu annab id, mitte tühja nime', () => {
    expect(selectionDisplay({ kind: 'collection', id: 'kadunud' }, COLLECTIONS, SETS, 'et'))
      .toEqual({ kind: 'collection', id: 'kadunud', name: 'kadunud' });
  });
});
