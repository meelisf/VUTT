import { describe, it, expect } from 'vitest';
import { resolveApproveScope } from '../approveScope';

describe('resolveApproveScope', () => {
  it('ilma admini valikuta kehtib taotleja soov', () => {
    expect(resolveApproveScope(undefined, ['ag', 'agc'])).toEqual(['ag', 'agc']);
  });

  it('admini valik võidab soovi', () => {
    expect(resolveApproveScope(['agc'], ['ag'])).toEqual(['agc']);
  });

  it('admini TEADLIK tühi valik võidab soovi', () => {
    // `||` tooks siin soovi tagasi: admin võtaks ulatuse maha ja see ilmuks
    // uuesti, ilma et ta seda näeks.
    expect(resolveApproveScope([], ['ag', 'agc'])).toEqual([]);
  });

  it('soovita taotlus algab tühjast', () => {
    expect(resolveApproveScope(undefined, undefined)).toEqual([]);
    expect(resolveApproveScope(undefined, [])).toEqual([]);
  });
});
