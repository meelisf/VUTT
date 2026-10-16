// Registrist tuletatud tarbijaloendid (ADR 0071). Iga loend on ÜKS kord siin —
// käsitsi kordusloendit ei ole.
import { tagAlternation, VUTT_TAG_REGISTRY } from './vuttTags';

/** „Puhasta" (cleanMarkup): eemaldatavad tägid; annotatsioon (annN) jääb. */
export const CLEAN_MARKUP_TAG_RE = new RegExp(`<\\/?(?:${tagAlternation(t => t.cleanMarkup === 'remove')})[^>]*>`, 'g');

/** wrapTagUtils: stiilitäg (i, b, cs) liigub nende SISSE. */
export const STRUCTURAL_TAGS: readonly string[] = VUTT_TAG_REGISTRY.filter(t => t.wrapBlock).map(t => t.name);

/** Lugemisvaade: `<`, mis EI alusta registri tägi, escape'itakse (HTML-injektsiooni kaitse). */
export const RENDER_ALLOWED_RE = new RegExp(`<(?!\\/?(?:${tagAlternation(() => true)})\\b)`, 'g');
