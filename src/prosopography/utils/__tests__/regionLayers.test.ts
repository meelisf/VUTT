import { describe, expect, it, vi } from 'vitest';
import {
  REGION_DETAIL_ZOOM,
  REGION_LAYERS,
  pickRegionFeature,
  regionQueryLayers,
} from '../regionLayers';

describe('regionQueryLayers', () => {
  it('küsib väljasuumitult ainult katusüksuse kihti', () => {
    expect(regionQueryLayers(REGION_DETAIL_ZOOM - 1)).toEqual([REGION_LAYERS.l2Fill]);
  });

  it('küsib sissesuumitult alamüksust enne katusüksust', () => {
    expect(regionQueryLayers(REGION_DETAIL_ZOOM + 1)).toEqual([
      REGION_LAYERS.l3Fill,
      REGION_LAYERS.l2Fill,
    ]);
  });

  it('lävendil endal kehtib juba detailne vaade', () => {
    expect(regionQueryLayers(REGION_DETAIL_ZOOM)).toEqual([
      REGION_LAYERS.l3Fill,
      REGION_LAYERS.l2Fill,
    ]);
  });
});

describe('pickRegionFeature', () => {
  it('eelistab alamüksust, kui see tabab', () => {
    const query = vi.fn((layerId: string) => (
      layerId === REGION_LAYERS.l3Fill ? ['ringkond'] : ['impeerium']
    ));
    expect(pickRegionFeature(REGION_DETAIL_ZOOM + 1, query)).toBe('ringkond');
  });

  it('langeb katusüksusele tagasi alamüksuseta augu kohal', () => {
    const query = vi.fn((layerId: string) => (
      layerId === REGION_LAYERS.l3Fill ? [] : ['impeerium']
    ));
    expect(pickRegionFeature(REGION_DETAIL_ZOOM + 1, query)).toBe('impeerium');
  });

  it('ei küsi väljasuumitult alamüksuse kihti üldse', () => {
    const query = vi.fn(() => ['impeerium']);
    expect(pickRegionFeature(REGION_DETAIL_ZOOM - 1, query)).toBe('impeerium');
    expect(query).toHaveBeenCalledTimes(1);
    expect(query).toHaveBeenCalledWith(REGION_LAYERS.l2Fill);
  });

  it('tagastab null, kui ükski kiht ei taba', () => {
    expect(pickRegionFeature(REGION_DETAIL_ZOOM + 1, () => [])).toBeNull();
  });

  it('võtab kihi sees esimese ehk pealmise vaste', () => {
    const query = vi.fn((layerId: string) => (
      layerId === REGION_LAYERS.l3Fill ? ['väiksem', 'suurem'] : []
    ));
    expect(pickRegionFeature(REGION_DETAIL_ZOOM + 1, query)).toBe('väiksem');
  });
});
