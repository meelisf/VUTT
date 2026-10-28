import { describe, it, expect } from 'vitest';
import { jobConflictAction, resumeFollower } from '../jobKind';

describe('jobKind (ADR 0074): teose taustatöö jälgitakse liigi järgi', () => {
  it('409 + sama liigi töö käib → jälgi', () => {
    expect(jobConflictAction({ state: 'running', kind: 'page_ops' }, 'page_ops')).toBe('follow');
    expect(jobConflictAction({ state: 'running', kind: 'add_pdf' }, 'add_pdf')).toBe('follow');
  });

  it('409 + teise liigi töö käib → teade, mitte jälgimine', () => {
    expect(jobConflictAction({ state: 'running', kind: 'add_pdf' }, 'page_ops')).toBe('other');
    expect(jobConflictAction({ state: 'running', kind: 'page_ops' }, 'add_pdf')).toBe('other');
  });

  it('409, aga töö lõppes vahepeal → proovi uuesti', () => {
    expect(jobConflictAction({ state: 'done', kind: 'add_pdf' }, 'page_ops')).toBe('retry');
    expect(jobConflictAction({ state: 'idle' }, 'add_pdf')).toBe('retry');
  });

  it('liigita jooksev töö (vana server) on lehetoimingud', () => {
    expect(jobConflictAction({ state: 'running' }, 'page_ops')).toBe('follow');
    expect(jobConflictAction({ state: 'running' }, 'add_pdf')).toBe('other');
  });

  it('lehe avamisel valitakse jälgija liigi järgi', () => {
    expect(resumeFollower({ state: 'running' })).toBe('page_ops');
    expect(resumeFollower({ state: 'running', kind: 'add_pdf' })).toBe('add_pdf');
    expect(resumeFollower({ state: 'done', kind: 'add_pdf' })).toBeNull();
    expect(resumeFollower({ state: 'idle' })).toBeNull();
  });
});
