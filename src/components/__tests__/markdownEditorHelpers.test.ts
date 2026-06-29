import { describe, it, expect } from 'vitest';
import {
  applyWrap,
  applyLinePrefix,
  looksLikeUrl,
  linkPrefillFromSelection,
  insertLink,
} from '../markdownEditorHelpers';

describe('applyWrap', () => {
  it('wraps a non-empty selection and keeps the inner text selected', () => {
    const r = applyWrap('Fischer', 0, 7, '**', 'paks');
    expect(r.text).toBe('**Fischer**');
    expect(r.start).toBe(2);
    expect(r.end).toBe(9);
  });

  it('inserts a placeholder when the selection is empty and selects it', () => {
    const r = applyWrap('', 0, 0, '**', 'paks');
    expect(r.text).toBe('**paks**');
    expect(r.start).toBe(2);
    expect(r.end).toBe(6);
  });

  it('wraps in the middle of existing text', () => {
    const r = applyWrap('a b c', 2, 3, '*', 'x');
    expect(r.text).toBe('a *b* c');
    expect(r.start).toBe(3);
    expect(r.end).toBe(4);
  });
});

describe('applyLinePrefix', () => {
  it('adds a heading prefix to the current line', () => {
    const r = applyLinePrefix('Title\nbody', 0, 0, '## ');
    expect(r.text).toBe('## Title\nbody');
  });

  it('prefixes every selected line for a list', () => {
    const r = applyLinePrefix('a\nb\nc', 0, 5, '- ', { skipIfPresent: true });
    expect(r.text).toBe('- a\n- b\n- c');
  });

  it('skips lines that already have the prefix (no duplication)', () => {
    const r = applyLinePrefix('- a\nb\nc', 0, 7, '- ', { skipIfPresent: true });
    expect(r.text).toBe('- a\n- b\n- c');
  });
});

describe('looksLikeUrl', () => {
  it('detects http/https/www', () => {
    expect(looksLikeUrl('https://archive.org/x')).toBe(true);
    expect(looksLikeUrl('  http://x ')).toBe(true);
    expect(looksLikeUrl('www.example.com')).toBe(true);
  });
  it('rejects plain text', () => {
    expect(looksLikeUrl('Johann Fischer')).toBe(false);
  });
});

describe('linkPrefillFromSelection', () => {
  it('prefills URL field when selection is a URL (focus on text)', () => {
    const p = linkPrefillFromSelection('https://archive.org/very/long');
    expect(p.url).toBe('https://archive.org/very/long');
    expect(p.linkText).toBe('');
    expect(p.focusField).toBe('text');
  });
  it('prefills link text when selection is plain text (focus on url)', () => {
    const p = linkPrefillFromSelection('Johann Fischer');
    expect(p.linkText).toBe('Johann Fischer');
    expect(p.url).toBe('');
    expect(p.focusField).toBe('url');
  });
  it('focuses text field when selection is empty', () => {
    const p = linkPrefillFromSelection('');
    expect(p.focusField).toBe('text');
  });
});

describe('insertLink', () => {
  it('replaces a selection with a markdown link', () => {
    const r = insertLink('Johann Fischer', 0, 14, 'Johann Fischer', 'http://x');
    expect(r.text).toBe('[Johann Fischer](http://x)');
    expect(r.start).toBe(r.end);
  });
  it('falls back to url as label when label empty', () => {
    const r = insertLink('', 0, 0, '', 'http://x');
    expect(r.text).toBe('[http://x](http://x)');
  });
  it('prepends https:// to protocol-less www. urls (avoids broken relative link)', () => {
    const r = insertLink('site', 0, 4, 'site', 'www.example.com');
    expect(r.text).toBe('[site](https://www.example.com)');
  });
  it('leaves urls that already have a protocol untouched', () => {
    const r = insertLink('site', 0, 4, 'site', 'https://www.example.com');
    expect(r.text).toBe('[site](https://www.example.com)');
  });
});
