import { describe, expect, it } from 'vitest';
import {
  applyDefaultSplitTo,
  applyGlobalSplit,
  clampSplitX,
  clearDefaultSplit,
  countByMode,
  countOutputPages,
  isPreviewReady,
  mergePreviewProgress,
  setExcluded,
  setNoSplit,
  summarizePlan,
  willSplit,
} from '../prepressPlan';
import type { PrepressPlan } from '../types';

function plan(overrides: Partial<PrepressPlan> = {}): PrepressPlan {
  return {
    default_split_x: 0.5,
    preview_status: 'ready',
    preview_done: 3,
    preview_cancel: false,
    page_count: 3,
    output_page_count: 6,
    trivial: false,
    status: 'awaiting_split',
    ocr_model: 'print',
    pages: [
      { n: 1, mode: 'default', split_x: null, excluded: false },
      { n: 2, mode: 'custom', split_x: 0.459, excluded: false },
      { n: 3, mode: 'nosplit', split_x: null, excluded: false },
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

  it('läbivalt nosplit plaan → iga leht üks', () => {
    const p = plan({ pages: plan().pages.map((x) => ({ ...x, mode: 'nosplit' as const, split_x: null })) });
    expect(countOutputPages(p)).toBe(3);
  });
});

describe('summarizePlan', () => {
  it('loeb poolitatavad, väljajäetud ja väljundlehed', () => {
    const p = plan();
    p.pages[0].excluded = true;
    expect(summarizePlan(p)).toEqual({ split: 1, excluded: 1, output: 3 });
  });

  it('läbivalt nosplit plaan → ühtki lehte ei poolitata', () => {
    const p = plan({ pages: plan().pages.map((x) => ({ ...x, mode: 'nosplit' as const, split_x: null })) });
    expect(summarizePlan(p).split).toBe(0);
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

describe('isPreviewReady', () => {
  it('renderdamise ajal on valmis ainult juba tehtud lehed', () => {
    // REGRESSIOON: <img src> valmimata lehele annab 404 ja jääb PÜSIVALT
    // katki — polling ei muuda src-i, seega React ei loo uut img-elementi.
    const p = plan({ preview_status: 'rendering', preview_done: 2 });
    expect(isPreviewReady(p, 1)).toBe(true);
    expect(isPreviewReady(p, 2)).toBe(true);
    expect(isPreviewReady(p, 3)).toBe(false);
  });

  it('alguses ei ole ükski leht valmis', () => {
    const p = plan({ preview_status: 'rendering', preview_done: 0 });
    expect(isPreviewReady(p, 1)).toBe(false);
  });

  it('ready-olekus on kõik lehed valmis', () => {
    const p = plan({ preview_status: 'ready', preview_done: 3 });
    expect(isPreviewReady(p, 3)).toBe(true);
  });

  it('katkenud renderdus jätab juba tehtud lehed nähtavaks', () => {
    const p = plan({ preview_status: 'error', preview_done: 2 });
    expect(isPreviewReady(p, 2)).toBe(true);
    expect(isPreviewReady(p, 3)).toBe(false);
  });

  it('idle: enne eelvaate käivitumist pole ühtki pikslit renderdatud', () => {
    const p = plan({ preview_status: 'idle', preview_done: 0 });
    expect(isPreviewReady(p, 1)).toBe(false);
  });
});

describe('vaikeplaani semantika', () => {
  it('vaikeplaani lehed ei poolitu', () => {
    const p = plan({
      page_count: 2,
      pages: [
        { n: 1, mode: 'nosplit', split_x: null, excluded: false },
        { n: 2, mode: 'nosplit', split_x: null, excluded: false },
      ],
    });
    expect(willSplit(p, 1)).toBe(false);
    expect(countOutputPages(p)).toBe(2);
    expect(summarizePlan(p).split).toBe(0);
  });

  it('default-moodis leht poolitub ilma igasuguse lülitita', () => {
    const p = plan({
      page_count: 1,
      pages: [{ n: 1, mode: 'default', split_x: null, excluded: false }],
    });
    expect(willSplit(p, 1)).toBe(true);
    expect(countOutputPages(p)).toBe(2);
  });
});

describe('willSplit', () => {
  it('vaikeseades leht poolitatakse', () => {
    expect(willSplit(plan(), 1)).toBe(true);
  });

  it('custom joonega leht poolitatakse', () => {
    expect(willSplit(plan(), 2)).toBe(true);
  });

  it('nosplit-lehte EI poolitata', () => {
    expect(willSplit(plan(), 3)).toBe(false);
  });

  it('väljajäetud lehte EI poolitata (ka default-moodis)', () => {
    const p = plan();
    p.pages[0].excluded = true;
    expect(willSplit(p, 1)).toBe(false);
  });

  it('nosplit on vaikeväärtus, mitte lüliti tagajärg', () => {
    const p = plan({ pages: [{ n: 1, mode: 'nosplit', split_x: null, excluded: false }] });
    expect(willSplit(p, 1)).toBe(false);
  });

  it('custom ilma split_x-ita ei poolita (sama loogika mis countOutputPages)', () => {
    const p = plan();
    p.pages[1].split_x = null;
    expect(willSplit(p, 2)).toBe(false);
  });

  it('tundmatu leht', () => {
    expect(willSplit(plan(), 99)).toBe(false);
  });
});


// --- Hulgioperatsioonid (§2, §6, §7, §11) ---

const mixed = () => plan({
  page_count: 4,
  pages: [
    { n: 1, mode: 'nosplit', split_x: null, excluded: false },
    { n: 2, mode: 'custom', split_x: 0.42, excluded: false },
    { n: 3, mode: 'nosplit', split_x: null, excluded: true },
    { n: 4, mode: 'default', split_x: null, excluded: false },
  ],
});

describe('applyDefaultSplitTo', () => {
  it('viib nosplit-lehed default-i ega puutu custom-i (§7)', () => {
    const next = applyDefaultSplitTo(mixed());
    expect(next.pages.map((p) => p.mode)).toEqual(['default', 'custom', 'default', 'default']);
    expect(next.pages[1].split_x).toBe(0.42);
  });

  it('valikuga puudutab ainult nimetatud lehti', () => {
    const next = applyDefaultSplitTo(mixed(), [1]);
    expect(next.pages.map((p) => p.mode)).toEqual(['default', 'custom', 'nosplit', 'default']);
  });

  it('ei muuda algset plaani', () => {
    const original = mixed();
    applyDefaultSplitTo(original);
    expect(original.pages[0].mode).toBe('nosplit');
  });
});

describe('clearDefaultSplit', () => {
  it('võtab maha ainult üldjoone; käsitsi seatu jääb (§2)', () => {
    const next = clearDefaultSplit(mixed());
    expect(next.pages.map((p) => p.mode)).toEqual(['nosplit', 'custom', 'nosplit', 'nosplit']);
    expect(next.pages[1].split_x).toBe(0.42);
  });
});

describe('setNoSplit', () => {
  it('valikul on otsene: puudutab ka custom-lehti (§7)', () => {
    const next = setNoSplit(mixed(), [2, 4]);
    expect(next.pages.map((p) => p.mode)).toEqual(['nosplit', 'nosplit', 'nosplit', 'nosplit']);
    expect(next.pages[1].split_x).toBeNull();
  });
});

describe('setExcluded', () => {
  it('EI kustuta poolitusolekut (§11 invariant)', () => {
    const out = setExcluded(mixed(), [2], true);
    expect(out.pages[1].excluded).toBe(true);
    expect(out.pages[1].mode).toBe('custom');
    expect(out.pages[1].split_x).toBe(0.42);

    const back = setExcluded(out, [2], false);
    expect(back.pages[1].mode).toBe('custom');
    expect(back.pages[1].split_x).toBe(0.42);
  });

  it('väljajäetud leht ei loe kokkuvõttes (§11)', () => {
    const p = setExcluded(applyDefaultSplitTo(mixed()), [1], true);
    // lk 1 ja lk 3 väljas; lk 2 custom → 2 lehte; lk 4 default → 2 lehte
    expect(countOutputPages(p)).toBe(4);
    expect(summarizePlan(p).split).toBe(2);      // väljajäetut EI loeta
    expect(summarizePlan(p).excluded).toBe(2);
  });
});

describe('countByMode', () => {
  it('annab tegevusriba teate arvud', () => {
    expect(countByMode(mixed(), [1, 2, 3, 4])).toEqual({ applied: 3, keptCustom: 1 });
  });
});

describe('mergePreviewProgress', () => {
  it('võtab pollilt AINULT eelvaate edenemise', () => {
    const kohalik = plan({ preview_status: 'rendering', preview_done: 2 });
    const serverilt = plan({ preview_status: 'rendering', preview_done: 5 });

    expect(mergePreviewProgress(kohalik, serverilt).preview_done).toBe(5);
  });

  it('EI kirjuta üle salvestamata poolitusotsust', () => {
    // Kasutaja klõpsas „poolita" lk 3-l; debounce'itud salvestus pole veel
    // kohale jõudnud, seega server tagastab endiselt `nosplit`. Terve plaani
    // asendamine kustutaks klõpsu ära ja joon kaoks sekundiks ekraanilt.
    const kohalik = plan({
      preview_status: 'rendering',
      pages: [
        { n: 1, mode: 'default', split_x: null, excluded: false },
        { n: 2, mode: 'custom', split_x: 0.459, excluded: false },
        { n: 3, mode: 'default', split_x: null, excluded: false },
      ],
    });
    const serverilt = plan({ preview_status: 'rendering', preview_done: 5 });

    const tulem = mergePreviewProgress(kohalik, serverilt);

    expect(tulem.pages[2].mode).toBe('default');
    expect(tulem.preview_done).toBe(5);
  });

  it('EI kirjuta üle salvestamata üldjoont ega mudelivalikut', () => {
    const kohalik = plan({
      preview_status: 'rendering', default_split_x: 0.42, ocr_model: 'hand',
    });
    const serverilt = plan({ preview_status: 'rendering', preview_done: 5 });

    const tulem = mergePreviewProgress(kohalik, serverilt);

    expect(tulem.default_split_x).toBe(0.42);
    expect(tulem.ocr_model).toBe('hand');
  });

  it('esimesel laadimisel (kohalikku plaani veel ei ole) võtab serveri oma', () => {
    const serverilt = plan();
    expect(mergePreviewProgress(null, serverilt)).toBe(serverilt);
  });
});
