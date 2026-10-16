// VUTT-i märgenduse register (ADR 0071): VUTT-i märgendus on TEI alamhulga
// lühisüntaks — iga täg koos TEI vaste ja käitumisega. Pythoni peegel:
// server/vutt_tags.py. Plokk REGISTRY-START…END on RANGE JSON (topeltjutumärgid,
// ilma lõpukomadeta): tests/test_vutt_tags_parity.py loeb ja võrdleb seda.

export interface VuttTagDef {
  name: string;
  tei: string;
  paired: boolean;
  search: 'keep' | 'drop' | 'marginalia';
  pageMark: boolean;
  numbered: boolean;
  marginaliaInline: boolean;
  stripEmpty: boolean;
  cleanMarkup: 'remove' | 'keep';
  wrapBlock: boolean;
}

export const VUTT_TAG_REGISTRY: readonly VuttTagDef[] =
// REGISTRY-START
[
  {"name": "i", "tei": "hi rend=\"italic\"", "paired": true, "search": "keep", "pageMark": false, "numbered": false, "marginaliaInline": true, "stripEmpty": true, "cleanMarkup": "remove", "wrapBlock": false},
  {"name": "b", "tei": "hi rend=\"bold\"", "paired": true, "search": "keep", "pageMark": false, "numbered": false, "marginaliaInline": true, "stripEmpty": true, "cleanMarkup": "remove", "wrapBlock": false},
  {"name": "cs", "tei": "hi (kiri vastupidine teose põhikirjale; ADR 0071 erand)", "paired": true, "search": "keep", "pageMark": false, "numbered": false, "marginaliaInline": true, "stripEmpty": true, "cleanMarkup": "remove", "wrapBlock": false},
  {"name": "hi", "tei": "hi", "paired": true, "search": "keep", "pageMark": false, "numbered": false, "marginaliaInline": true, "stripEmpty": true, "cleanMarkup": "remove", "wrapBlock": true},
  {"name": "m", "tei": "note place=\"margin\"", "paired": true, "search": "marginalia", "pageMark": false, "numbered": false, "marginaliaInline": false, "stripEmpty": true, "cleanMarkup": "remove", "wrapBlock": true},
  {"name": "add", "tei": "add", "paired": true, "search": "keep", "pageMark": false, "numbered": false, "marginaliaInline": true, "stripEmpty": true, "cleanMarkup": "remove", "wrapBlock": true},
  {"name": "ann", "tei": "anchor/span — toimetaja märkuse ankur (ADR 0041)", "paired": true, "search": "keep", "pageMark": false, "numbered": true, "marginaliaInline": true, "stripEmpty": false, "cleanMarkup": "keep", "wrapBlock": false},
  {"name": "fn", "tei": "ref type=\"note\"", "paired": true, "search": "drop", "pageMark": false, "numbered": false, "marginaliaInline": false, "stripEmpty": false, "cleanMarkup": "remove", "wrapBlock": true},
  {"name": "pb", "tei": "pb", "paired": false, "search": "drop", "pageMark": false, "numbered": false, "marginaliaInline": false, "stripEmpty": false, "cleanMarkup": "remove", "wrapBlock": false},
  {"name": "fw", "tei": "fw type=\"pageNum\"", "paired": true, "search": "drop", "pageMark": true, "numbered": false, "marginaliaInline": true, "stripEmpty": true, "cleanMarkup": "remove", "wrapBlock": true},
  {"name": "sig", "tei": "fw type=\"sig\"", "paired": true, "search": "drop", "pageMark": true, "numbered": false, "marginaliaInline": true, "stripEmpty": true, "cleanMarkup": "remove", "wrapBlock": true},
  {"name": "catch", "tei": "fw type=\"catch\"", "paired": true, "search": "drop", "pageMark": true, "numbered": false, "marginaliaInline": true, "stripEmpty": true, "cleanMarkup": "remove", "wrapBlock": true},
  {"name": "rh", "tei": "fw type=\"header\"", "paired": true, "search": "drop", "pageMark": true, "numbered": false, "marginaliaInline": true, "stripEmpty": true, "cleanMarkup": "remove", "wrapBlock": true}
]
// REGISTRY-END
;

export type PageMarkKind = 'fw' | 'sig' | 'catch' | 'rh';

export const PAGE_MARK_KINDS: readonly PageMarkKind[] =
  VUTT_TAG_REGISTRY.filter(t => t.pageMark).map(t => t.name as PageMarkKind);

/** Regexi osa tägi nime jaoks (`ann\d*` nummerdatul). */
export function tagPattern(t: VuttTagDef): string {
  return t.numbered ? `${t.name}\\d*` : t.name;
}

/** Nimed alternatsioonina registri predikaadi järgi, nt `i|b|cs`. */
export function tagAlternation(pred: (t: VuttTagDef) => boolean): string {
  return VUTT_TAG_REGISTRY.filter(pred).map(tagPattern).join('|');
}
