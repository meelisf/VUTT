// Registrist tuletatud tarbijaloendid (ADR 0071). Iga loend on ÜKS kord siin —
// käsitsi kordusloendit ei ole.
import { tagAlternation, VUTT_TAG_REGISTRY } from './vuttTags';

/** wrapTagUtils: stiilitäg (i, b, f) liigub nende SISSE. */
export const STRUCTURAL_TAGS: readonly string[] = VUTT_TAG_REGISTRY.filter(t => t.wrapBlock).map(t => t.name);

/** Lugemisvaade: `<`, mis EI alusta registri tägi, escape'itakse (HTML-injektsiooni kaitse). */
export const RENDER_ALLOWED_RE = new RegExp(`<(?!\\/?(?:${tagAlternation(() => true)})\\b)`, 'g');

/** „Puhasta" valiku peal: stiilitägid, mille paar poolitatakse valiku kohalt
 *  (i, b, f, hi, add). Struktuur (m, fn, pb, lehe tähistus) eemaldub ainult
 *  tervikuna, annotatsioon (cleanMarkup 'keep') ei eemaldu kunagi. */
export const CLEAN_SPLIT_TAGS: readonly string[] = VUTT_TAG_REGISTRY
  .filter(t => t.cleanMarkup === 'remove' && t.marginaliaInline && !t.pageMark)
  .map(t => t.name);

/** Stiilitägid (i, b, f): liiguvad struktuuritägide sisse (wrapTagUtils) ja
 *  lülituvad marginaaliakaardi peal tervikuna. */
export const STYLE_TAGS: readonly string[] = VUTT_TAG_REGISTRY
  .filter(t => t.marginaliaInline && !t.wrapBlock && !t.pageMark && !t.numbered)
  .map(t => t.name);
