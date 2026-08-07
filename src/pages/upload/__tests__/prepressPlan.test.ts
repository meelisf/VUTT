import { describe, expect, it } from 'vitest';
import {
  applyGlobalSplit,
  clampSplitX,
  countOutputPages,
  inkLevel,
  summarizePlan,
  visibleWindow,
} from '../prepressPlan';
import type { PrepressPlan } from '../types';

function plan(overrides: Partial<PrepressPlan> = {}): PrepressPlan {
  return {
    enabled: true,
    default_split_x: 0.5,
    preview_status: 'ready',
    preview_done: 3,
    page_count: 3,
    output_page_count: 6,
    trivial: false,
    status: 'awaiting_split',
    pages: [
      { n: 1, mode: 'default', split_x: null, excluded: false, ink: 0.08 },
      { n: 2, mode: 'custom', split_x: 0.459, excluded: false, ink: 0.99 },
      { n: 3, mode: 'nosplit', split_x: null, excluded: false, ink: 0.02 },
    ],
    ...overrides,
  };
}

describe('applyGlobalSplit', () => {
  it('muudab globaalset joont', () => {
    expect(applyGlobalSplit(plan(), 0.48).default_split_x).toBe(0.48);
  });

  it('EI kirjuta üle custom-lehti', () => {
    const next = applyGlobalSplit(plan(), 0.48);
    expect(next.pages[1].mode).toBe('custom');
    expect(next.pages[1].split_x).toBe(0.459);
  });

  it('EI muuda nosplit-lehti', () => {
    expect(applyGlobalSplit(plan(), 0.48).pages[2].mode).toBe('nosplit');
  });

  it('ei muteeri sisendit', () => {
    const original = plan();
    applyGlobalSplit(original, 0.48);
    expect(original.default_split_x).toBe(0.5);
  });
});

describe('countOutputPages', () => {
  it('loeb poolitatud lehed kaks korda', () => {
    // leht 1 default → 2, leht 2 custom → 2, leht 3 nosplit → 1
    expect(countOutputPages(plan())).toBe(5);
  });

  it('jätab väljajäetud lehed välja', () => {
    const p = plan();
    p.pages[0].excluded = true;
    expect(countOutputPages(p)).toBe(3);
  });

  it('enabled=false → iga leht üks', () => {
    expect(countOutputPages(plan({ enabled: false }))).toBe(3);
  });
});

describe('summarizePlan', () => {
  it('loeb poolitatavad, väljajäetud ja väljundlehed', () => {
    const p = plan();
    p.pages[0].excluded = true;
    expect(summarizePlan(p)).toEqual({ split: 1, excluded: 1, output: 3 });
  });

  it('enabled=false → ühtki lehte ei poolitata', () => {
    expect(summarizePlan(plan({ enabled: false })).split).toBe(0);
  });
});

describe('inkLevel', () => {
  it('mõõdetud väärtused päris materjalilt (EAA 1253)', () => {
    expect(inkLevel(0.08)).toBe('ok');    // leht 1: puhas
    expect(inkLevel(0.48)).toBe('warn');  // leht 2: kiri läheb joonest üle
    expect(inkLevel(0.99)).toBe('bad');   // leht 3: joon on murdevarjus
  });

  it('arvutamata skoor on ok, mitte hoiatus', () => {
    expect(inkLevel(null)).toBe('ok');
  });

  it('läved on kaasavad', () => {
    expect(inkLevel(0.8)).toBe('bad');
    expect(inkLevel(0.25)).toBe('warn');
    expect(inkLevel(0.2499)).toBe('ok');
  });
});

describe('visibleWindow', () => {
  it('annab ainult nähtava akna pluss overscan', () => {
    // 500 px laius / 100 px element = 5 nähtavat; +2 overscan mõlemale poole
    expect(visibleWindow(0, 100, 500, 300, 2)).toEqual([0, 7]);
  });

  it('keskel kerides nihkub aken kaasa', () => {
    expect(visibleWindow(1000, 100, 500, 300, 2)).toEqual([8, 17]);
  });

  it('EI lae 300-lehelise teose puhul kõiki ribasid', () => {
    const [start, end] = visibleWindow(0, 132, 1200, 300, 3);
    expect(end - start).toBeLessThan(20);
  });

  it('ei lähe üle lehtede arvu', () => {
    expect(visibleWindow(100000, 100, 500, 12, 2)[1]).toBeLessThanOrEqual(12);
  });

  it('ei anna negatiivset algust', () => {
    expect(visibleWindow(0, 100, 500, 300, 5)[0]).toBe(0);
  });
});

describe('clampSplitX', () => {
  it('jätab kehtiva väärtuse puutumata', () => {
    expect(clampSplitX(0.5)).toBe(0.5);
    expect(clampSplitX(0.459)).toBe(0.459);
  });

  it('hoiab vahemikus, kus mõlemad pooled jäävad olemas', () => {
    expect(clampSplitX(-1)).toBe(0.05);
    expect(clampSplitX(2)).toBe(0.95);
    expect(clampSplitX(0.01)).toBe(0.05);
    expect(clampSplitX(0.99)).toBe(0.95);
  });

  it('vastab backendi page_cuts servapiirangule', () => {
    // server: cut = max(1, min(width - 1, round(width * x)))
    expect(clampSplitX(0)).toBeGreaterThan(0);
    expect(clampSplitX(1)).toBeLessThan(1);
  });
});
