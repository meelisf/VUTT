import { describe, it, expect } from 'vitest';
import {
  defaultQuad, quadFromCropRect, quadToDisplayPx, quadPtFromDisplayPx, Quad4,
} from '../perspectiveQuad';

describe('perspectiveQuad', () => {
  it('defaultQuad on inset servadest, järjekord TL,TR,BR,BL', () => {
    const q = defaultQuad(0.05);
    expect(q).toEqual([
      { x: 0.05, y: 0.05 }, { x: 0.95, y: 0.05 },
      { x: 0.95, y: 0.95 }, { x: 0.05, y: 0.95 },
    ]);
  });

  it('quadFromCropRect annab ristküliku 4 nurka TL,TR,BR,BL', () => {
    const q = quadFromCropRect({ x: 0.1, y: 0.2, w: 0.4, h: 0.3 });
    expect(q).toEqual([
      { x: 0.1, y: 0.2 }, { x: 0.5, y: 0.2 },
      { x: 0.5, y: 0.5 }, { x: 0.1, y: 0.5 },
    ]);
  });

  it('quadToDisplayPx skaleerib display-mõõtudesse', () => {
    const q: Quad4 = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }];
    expect(quadToDisplayPx(q, 200, 100)).toEqual([
      { x: 0, y: 0 }, { x: 200, y: 0 }, { x: 200, y: 100 }, { x: 0, y: 100 },
    ]);
  });

  it('quadPtFromDisplayPx normaliseerib ja klambib [0,1]', () => {
    expect(quadPtFromDisplayPx(100, 50, 200, 100)).toEqual({ x: 0.5, y: 0.5 });
    expect(quadPtFromDisplayPx(-10, 200, 200, 100)).toEqual({ x: 0, y: 1 });
  });

  it('ümarsõit display→norm→display säilitab punktid', () => {
    const q: Quad4 = [{ x: 0.1, y: 0.1 }, { x: 0.9, y: 0.15 },
                      { x: 0.85, y: 0.9 }, { x: 0.12, y: 0.88 }];
    const px = quadToDisplayPx(q, 400, 300);
    const back = px.map((p) => quadPtFromDisplayPx(p.x, p.y, 400, 300));
    back.forEach((p, i) => {
      expect(p.x).toBeCloseTo(q[i].x, 6);
      expect(p.y).toBeCloseTo(q[i].y, 6);
    });
  });
});
