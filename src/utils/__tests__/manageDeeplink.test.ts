import { describe, it, expect } from 'vitest';
import { buildManageLink, parseFocusParam, buildBackToEditorPath } from '../manageDeeplink';

describe('buildManageLink', () => {
  it('ehitab focus-lingi', () => {
    expect(buildManageLink('abc123', 12)).toBe('/work/abc123/manage?focus=12');
  });
});

describe('parseFocusParam', () => {
  it('võtab vastu positiivse täisarvu', () => {
    expect(parseFocusParam('12')).toBe(12);
    expect(parseFocusParam('1')).toBe(1);
  });
  it('lükkab tagasi vigase sisendi', () => {
    expect(parseFocusParam(null)).toBeNull();
    expect(parseFocusParam('')).toBeNull();
    expect(parseFocusParam('abc')).toBeNull();
    expect(parseFocusParam('-1')).toBeNull();
    expect(parseFocusParam('0')).toBeNull();
    expect(parseFocusParam('12.5')).toBeNull();
    expect(parseFocusParam('12abc')).toBeNull();
  });
});

describe('buildBackToEditorPath', () => {
  it('kasutab focus-i kui olemas', () => {
    expect(buildBackToEditorPath('abc123', 12)).toBe('/work/abc123/12');
  });
  it('langeb tagasi lehele 1 kui focus puudub', () => {
    expect(buildBackToEditorPath('abc123', null)).toBe('/work/abc123/1');
  });
});
