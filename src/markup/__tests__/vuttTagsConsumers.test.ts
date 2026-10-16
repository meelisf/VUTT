// Tarbijaloendid võrduvad registri alamhulgaga (ADR 0071) — uus täg ei saa
// enam vaikselt mõnest kohast välja jääda.
import { describe, it, expect } from 'vitest';
import { VUTT_TAG_REGISTRY } from '../vuttTags';
import { CLEAN_MARKUP_TAG_RE, RENDER_ALLOWED_RE, STRUCTURAL_TAGS } from '../consumers';
import { VUTT_TAGS } from '../../components/editor/VuttMarkupExtension';

describe('registri tarbijad', () => {
  it('redaktori VUTT_TAGS = kõik registri tägid', () => {
    expect(new Set(VUTT_TAGS.map(t => t.tag))).toEqual(new Set(VUTT_TAG_REGISTRY.map(t => t.name)));
  });

  it('STRUCTURAL_TAGS = wrapBlock', () => {
    expect([...STRUCTURAL_TAGS].sort()).toEqual(VUTT_TAG_REGISTRY.filter(t => t.wrapBlock).map(t => t.name).sort());
  });

  it('Puhasta eemaldab cleanMarkup=remove tägid, ann jääb', () => {
    const s = '<i>a</i><fw>1</fw><sig>B</sig><ann2>x</ann2><pb/>';
    expect(s.replace(CLEAN_MARKUP_TAG_RE, '')).toBe('a1B<ann2>x</ann2>');
  });

  it('lugemisvaade lubab kõik registri tägid, muu escape', () => {
    for (const t of VUTT_TAG_REGISTRY) {
      const tag = t.numbered ? `<${t.name}1>` : `<${t.name}>`;
      expect(tag.replace(RENDER_ALLOWED_RE, '&lt;')).toBe(tag);
    }
    expect('<img src=x>'.replace(RENDER_ALLOWED_RE, '&lt;')).toBe('&lt;img src=x>');
  });
});
