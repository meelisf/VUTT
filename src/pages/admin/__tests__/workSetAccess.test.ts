import { describe, it, expect } from 'vitest';
import { applyUserRole, accessChanges } from '../workSetAccess';
import { WorkSetSummary } from '../../../services/workSetService';

const ws = (id: string, access: Record<string, 'viewer' | 'manager'>, revision = 3): WorkSetSummary =>
  ({ id, name: { et: id, en: id }, visibility: 'members', status: 'active',
     revision, can_manage: true, access } as WorkSetSummary);

describe('applyUserRole', () => {
  it('lisab rolli teiste kirjeid puutumata', () => {
    expect(applyUserRole({ mari: 'manager' }, 'juri', 'viewer'))
      .toEqual({ mari: 'manager', juri: 'viewer' });
  });

  it('eemaldab võtme, kui roll on null — tühi string jätaks kirje alles', () => {
    expect(applyUserRole({ mari: 'manager', juri: 'viewer' }, 'juri', null))
      .toEqual({ mari: 'manager' });
  });

  it('vahetab rolli', () => {
    expect(applyUserRole({ juri: 'viewer' }, 'juri', 'manager')).toEqual({ juri: 'manager' });
  });
});

describe('accessChanges', () => {
  const SETS = [
    ws('ws_1', { mari: 'manager' }),
    ws('ws_2', { juri: 'viewer' }),
    ws('ws_3', {}),
  ];

  it('saadab AINULT muudetud kogud', () => {
    const changes = accessChanges(SETS, 'juri', { ws_1: 'viewer', ws_2: 'viewer', ws_3: null });
    expect(changes.map(c => c.setId)).toEqual(['ws_1']);
    expect(changes[0].access).toEqual({ mari: 'manager', juri: 'viewer' });
    expect(changes[0].revision).toBe(3);
  });

  it('rolli eemaldamine on muudatus', () => {
    const changes = accessChanges(SETS, 'juri', { ws_2: null });
    expect(changes).toEqual([{ setId: 'ws_2', access: {}, revision: 3 }]);
  });

  it('muutusteta soov ei saada midagi', () => {
    expect(accessChanges(SETS, 'juri', { ws_2: 'viewer' })).toEqual([]);
  });

  it('nimetamata kogu jääb puutumata', () => {
    // Soovis puudub `ws_1` → tema access ei tohi muutuda, isegi kui kasutajal
    // seal rolli ei ole. Vaikimisi „puudub" kustutaks teiste antud õigused.
    expect(accessChanges(SETS, 'mari', { ws_2: null })).toEqual([]);
  });

  it('kogu, mida kutsuja ei halda, jäetakse vahele', () => {
    const kaitstud = [{ ...ws('ws_9', { x: 'viewer' }), can_manage: false } as WorkSetSummary];
    expect(accessChanges(kaitstud, 'juri', { ws_9: 'manager' })).toEqual([]);
  });
});
