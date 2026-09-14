import { describe, expect, it, vi } from 'vitest';
import { saveAccessChanges } from '../userWorkSetSave';
import { AccessChange } from '../workSetAccess';

const muudatus = (setId: string): AccessChange =>
  ({ setId, access: { mati: 'viewer' }, revision: 1 });

describe('saveAccessChanges', () => {
  it('salvestab iga kogu eraldi ja loetleb õnnestunud', async () => {
    const save = vi.fn().mockResolvedValue({});
    const tulemus = await saveAccessChanges([muudatus('a'), muudatus('b')], save);
    expect(save).toHaveBeenCalledTimes(2);
    expect(tulemus).toEqual({ saved: ['a', 'b'], failed: [] });
  });

  it('ühe kogu konflikt ei peata teiste salvestamist', async () => {
    // Kogud on ERALDI failid oma revision-lukuga: ühe 409 ei ütle teiste kohta
    // midagi ja katkestamine jätaks töö pooleli ilma põhjuseta.
    const save = vi.fn()
      .mockRejectedValueOnce(Object.assign(new Error('konflikt'), { status: 409 }))
      .mockResolvedValueOnce({});
    const tulemus = await saveAccessChanges([muudatus('a'), muudatus('b')], save);
    expect(save).toHaveBeenCalledTimes(2);
    expect(tulemus.saved).toEqual(['b']);
    expect(tulemus.failed).toEqual([{ setId: 'a', status: 409 }]);
  });

  it('tühi nimekiri ei kutsu salvestust', async () => {
    const save = vi.fn();
    expect(await saveAccessChanges([], save)).toEqual({ saved: [], failed: [] });
    expect(save).not.toHaveBeenCalled();
  });
});
