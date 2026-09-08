import { describe, expect, it } from 'vitest';
import { ruhmita, historyThumbUrl } from '../trashGrouping';
import type { DeletedWorkPage } from '../../../services/workApi';

const kirje = (filename: string, reason: string, restorable: boolean): DeletedWorkPage => ({
  filename, base_name: filename.replace('.jpg', ''), deleted_at: null, deleted_by: null,
  commit_hash: null, reason, restorable, v: 1,
});

describe('ruhmita', () => {
  it('kustutatud ja tundmatud on ühes plokis, jäägid teises', () => {
    const out = ruhmita([
      kirje('a.jpg', 'deleted', true),
      kirje('b.jpg', 'split', false),
      kirje('c.jpg', 'unknown', false),
    ]);
    expect(out.deleted.map((k) => k.filename)).toEqual(['a.jpg', 'c.jpg']);
    expect(out.split.map((k) => k.filename)).toEqual(['b.jpg']);
  });

  it('ükski kirje ei kao — ka tundmatu liigiga', () => {
    const sisend = [kirje('a.jpg', 'deleted', true), kirje('b.jpg', 'split', false),
                    kirje('c.jpg', 'unknown', false), kirje('d.jpg', 'midagi_uut', false)];
    const out = ruhmita(sisend);
    expect(out.deleted.length + out.split.length).toBe(sisend.length);
  });

  it('taastatavus tuleb serverist, mitte liigist', () => {
    // Server on ainus, kes otsustab; klient ei tohi reeglit korrata.
    const out = ruhmita([kirje('a.jpg', 'deleted', false)]);
    expect(out.deleted[0].restorable).toBe(false);
  });
});

describe('historyThumbUrl', () => {
  it('kannab versiooni ja tokeni kaasa', () => {
    const url = historyThumbUrl('w1', 'trash', 'a b.jpg', 12345, 'tok');
    expect(url).toContain('/admin/work/w1/history-thumb/trash/a%20b.jpg');
    expect(url).toContain('v=12345');
    expect(url).toContain('token=tok');
  });
});
