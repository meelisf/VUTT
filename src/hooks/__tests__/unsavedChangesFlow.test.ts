import { describe, it, expect, vi } from 'vitest';
import {
  initialGuardState,
  requestTransition,
  stay,
  discard,
  beginSave,
  finishSave,
  allowNextTransition,
  consumeAllowance,
} from '../unsavedChangesFlow';

describe('requestTransition', () => {
  it('lubab ülemineku kohe, kui muudatusi ei ole', () => {
    const run = vi.fn();
    const r = requestTransition(initialGuardState, false, { run });
    expect(r.runNow).toBe(true);
    expect(r.state.pending).toBeNull();
  });

  it('paneb ülemineku ootele, kui on salvestamata muudatusi', () => {
    const run = vi.fn();
    const r = requestTransition(initialGuardState, true, { run });
    expect(r.runNow).toBe(false);
    expect(r.state.pending?.run).toBe(run);
  });

  it('esimene ootel tegevus võidab — uus ei asenda seda', () => {
    const first = vi.fn();
    const second = vi.fn();
    const a = requestTransition(initialGuardState, true, { run: first });
    const b = requestTransition(a.state, true, { run: second });
    expect(b.runNow).toBe(false);
    expect(b.state.pending?.run).toBe(first);
  });

  it('salvestamise ajal saabuv uus soov ei muuda ootel tegevust', () => {
    const first = vi.fn();
    const second = vi.fn();
    const a = requestTransition(initialGuardState, true, { run: first });
    const saving = beginSave(a.state);
    const b = requestTransition(saving.state, true, { run: second });
    expect(b.runNow).toBe(false);
    expect(b.state.pending?.run).toBe(first);
    expect(b.state.saving).toBe(true);
  });
});

describe('stay', () => {
  it('eemaldab ootel tegevuse täielikult', () => {
    const run = vi.fn();
    const a = requestTransition(initialGuardState, true, { run });
    const s = stay(a.state);
    expect(s.pending).toBeNull();
    expect(s.saveFailed).toBe(false);
    expect(s.allowNext).toBe(false);
    expect(run).not.toHaveBeenCalled();
  });

  it('kustutab ka eelmise salvestusvea', () => {
    const a = requestTransition(initialGuardState, true, { run: vi.fn() });
    const failed = finishSave(beginSave(a.state).state, false);
    expect(failed.state.saveFailed).toBe(true);
    expect(stay(failed.state).saveFailed).toBe(false);
  });
});

describe('discard', () => {
  it('vabastab ootel tegevuse salvestamata ja annab ühekordse loa', () => {
    const run = vi.fn();
    const a = requestTransition(initialGuardState, true, { run });
    const d = discard(a.state);
    expect(d.action).toBe(run);
    expect(d.state.pending).toBeNull();
    expect(d.state.allowNext).toBe(true);
  });

  it('ei jäta möödapääsu aktiivseks pärast tarbimist', () => {
    const a = requestTransition(initialGuardState, true, { run: vi.fn() });
    const d = discard(a.state);
    const c = consumeAllowance(d.state);
    expect(c.allowed).toBe(true);
    expect(c.state.allowNext).toBe(false);
    expect(consumeAllowance(c.state).allowed).toBe(false);
  });
});

describe('beginSave', () => {
  it('alustab salvestamist, kui see veel ei käi', () => {
    const a = requestTransition(initialGuardState, true, { run: vi.fn() });
    const b = beginSave(a.state);
    expect(b.start).toBe(true);
    expect(b.state.saving).toBe(true);
    expect(b.state.saveFailed).toBe(false);
  });

  it('topeltklikk ei alusta teist salvestust', () => {
    const a = requestTransition(initialGuardState, true, { run: vi.fn() });
    const first = beginSave(a.state);
    const second = beginSave(first.state);
    expect(second.start).toBe(false);
    expect(second.state).toBe(first.state);
  });
});

describe('finishSave', () => {
  it('käivitab ootel tegevuse, kui salvestamine õnnestus', () => {
    const run = vi.fn();
    const a = requestTransition(initialGuardState, true, { run });
    const f = finishSave(beginSave(a.state).state, true);
    expect(f.action).toBe(run);
    expect(f.state.pending).toBeNull();
    expect(f.state.saving).toBe(false);
    expect(f.state.allowNext).toBe(true);
  });

  it('EI käivita ootel tegevust, kui salvestamine ebaõnnestus', () => {
    const run = vi.fn();
    const a = requestTransition(initialGuardState, true, { run });
    const f = finishSave(beginSave(a.state).state, false);
    expect(f.action).toBeNull();
    expect(f.state.pending?.run).toBe(run);
    expect(f.state.saving).toBe(false);
    expect(f.state.saveFailed).toBe(true);
    expect(f.state.allowNext).toBe(false);
  });

  it('pärast ebaõnnestunud salvestust saab uuesti salvestada', () => {
    const run = vi.fn();
    const a = requestTransition(initialGuardState, true, { run });
    const failed = finishSave(beginSave(a.state).state, false);
    const retry = beginSave(failed.state);
    expect(retry.start).toBe(true);
    expect(retry.state.saveFailed).toBe(false);
    const ok = finishSave(retry.state, true);
    expect(ok.action).toBe(run);
  });

  it('nullib oleku enne tegevuse tagastamist — tegevuse erind ei jäta guardi rippu', () => {
    const run = vi.fn(() => { throw new Error('navigate failed'); });
    const a = requestTransition(initialGuardState, true, { run });
    const f = finishSave(beginSave(a.state).state, true);
    expect(f.state.saving).toBe(false);
    expect(f.state.pending).toBeNull();
    expect(() => f.action?.()).toThrow('navigate failed');
    expect(f.state.saving).toBe(false);
    expect(f.state.pending).toBeNull();
  });
});

describe('allowNextTransition', () => {
  it('märgib järgmise ülemineku lubatuks ja luba on ühekordne', () => {
    const s = allowNextTransition(initialGuardState);
    const first = consumeAllowance(s);
    expect(first.allowed).toBe(true);
    expect(consumeAllowance(first.state).allowed).toBe(false);
  });
});
