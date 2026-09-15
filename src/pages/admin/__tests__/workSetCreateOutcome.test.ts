import { describe, expect, it } from 'vitest';
import { loomiseTulem } from '../workSetCreateOutcome';

describe('loomiseTulem', () => {
  it('katkenud vastus = kinnitamata, MITTE viga', () => {
    // Server võib töö lõpuni teha ka siis, kui klient on juba läinud:
    // `run_in_threadpool` lõime ei tühistata. „Ebaõnnestus" oleks vale väide
    // ja kordusklikk teeks duplikaadi.
    expect(loomiseTulem(new DOMException('aborted', 'AbortError'))).toBe('kinnitamata');
  });

  it('serveri tõrge on viga', () => {
    expect(loomiseTulem(new Error('HTTP 500'))).toBe('viga');
  });

  it('403 on viga, mitte kinnitamata olek', () => {
    expect(loomiseTulem({ name: 'ApiError', status: 403 })).toBe('viga');
  });
});
