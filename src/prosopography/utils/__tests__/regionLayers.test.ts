import { validateStyleMin } from '@maplibre/maplibre-gl-style-spec';
import { describe, expect, it, vi } from 'vitest';
import {
  REGION_DETAIL_ZOOM,
  REGION_LAYERS,
  REGION_SOURCE_ID,
  pickRegionFeature,
  regionLayerSpecs,
  regionQueryLayers,
} from '../regionLayers';

describe('regionLayerSpecs', () => {
  // Regressioon: varem oli 'fill-opacity' kujul ['case', hover, 0.42, ['interpolate',
  // ['linear'], ['zoom'], ...]]. MapLibre nõuab, et ['zoom'] oleks TIPPTASEME
  // interpolate/step sisend, ja lükkas kihi tagasi -> addLayer viskas erindi ->
  // ühtki kihti ei tekkinud -> ei värve ega tooltipi. TypeScript seda ei püüa.
  it('läbib MapLibre stiilispetsi valideerimise', () => {
    const errors = validateStyleMin({
      version: 8,
      sources: {
        [REGION_SOURCE_ID]: {
          type: 'geojson',
          data: { type: 'FeatureCollection', features: [] },
        },
      },
      layers: regionLayerSpecs(),
      // Spetsid on tahtlikult laia tüübiga; valideerija ise on siin päris värav.
    } as unknown as Parameters<typeof validateStyleMin>[0]);
    expect(errors.map(error => `${error.message}`)).toEqual([]);
  });

  it('annab kuus kihti mõlemale haldustasemele', () => {
    const ids = regionLayerSpecs().map(layer => layer.id);
    expect(ids).toEqual([
      REGION_LAYERS.l2Fill, REGION_LAYERS.l2Casing, REGION_LAYERS.l2Line,
      REGION_LAYERS.l3Fill, REGION_LAYERS.l3Casing, REGION_LAYERS.l3Line,
    ]);
  });
});

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
