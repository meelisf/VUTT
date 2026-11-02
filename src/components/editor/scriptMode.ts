// Lehe kirjastiili kuvamine (ADR 0077, punkt 2a): andmetes on fraktuur ALATI
// `<f>`-is (absoluutne), aga hall taust tõstab esile lehe VÄHEMUSKIRJA —
// antiikvalehel `<f>`, fraktuurlehel märgendamata ladina tähestiku tekst.
// Hall tähendab toimetajale seega endiselt „lehe põhikirjast erinev".
//
// Enamus arvutatakse lehe laadimisel / tervikasendusel / salvestamisel, MITTE iga
// muudatusega — muidu pöörduks ~50/50 lehel kogu esiletõst toimetamise ajal ümber.
import { Prec, StateEffect, StateField, type Extension, type Transaction } from '@codemirror/state';
import { Decoration, EditorView, type DecorationSet } from '@codemirror/view';
import { pageSwapAnnotation } from './editorAnnotations';

export type ScriptMode = 'antiqua' | 'fraktur';

export interface PageScript {
  mode: ScriptMode;
  /** Kas lehel on vähemalt üks `<f>` — ilma selleta alumise riba silti ei näidata. */
  hasF: boolean;
}

export interface ScriptRange { from: number; to: number }

const LATIN = /\p{Script=Latin}/u;
const TAG_RE = /<(\/?)([a-z]+)(\d*)(\/?)>/g;

/**
 * Märgib iga märgi kohta: kas ta on `<f>`-paari SISUS ja kas ta on tägi-tokeni osa.
 * Paaritus nagu redaktoris: sulgev `</f>` seotakse viimase avatud `<f>`-iga;
 * orb-täg ei ava ega sulge midagi.
 */
function scan(text: string): { inF: Uint8Array; inTag: Uint8Array; fRanges: ScriptRange[] } {
  const inF = new Uint8Array(text.length);
  const inTag = new Uint8Array(text.length);
  const fRanges: ScriptRange[] = [];
  const openStack: number[] = [];
  for (const m of text.matchAll(TAG_RE)) {
    const from = m.index;
    const to = from + m[0].length;
    for (let i = from; i < to; i++) inTag[i] = 1;
    if (m[2] !== 'f' || m[4]) continue;
    if (!m[1]) openStack.push(to);
    else if (openStack.length) fRanges.push({ from: openStack.pop()!, to: from });
  }
  for (const r of fRanges) for (let i = r.from; i < r.to; i++) inF[i] = 1;
  fRanges.sort((a, b) => a.from - b.from || a.to - b.to);
  return { inF, inTag, fRanges };
}

/** Lehe enamuskiri: ladina tähed `<f>`-is vs väljas (kreeka, heebrea, numbrid ja
 *  kirjavahemärgid ei loe). Viik → antiikva (VUTT-i korpuse vaikimisi juhtum). */
export function pageScript(text: string): PageScript {
  const { inF, inTag, fRanges } = scan(text);
  let f = 0;
  let a = 0;
  for (let i = 0; i < text.length; i++) {
    if (inTag[i] || !LATIN.test(text[i])) continue;
    if (inF[i]) f++; else a++;
  }
  return { mode: f > a ? 'fraktur' : 'antiqua', hasF: fRanges.length > 0 };
}

/**
 * Vähemuskirja vahemikud kuvamiseks.
 * - antiikvarežiimis: `<f>`-paaride sisu;
 * - fraktuurirežiimis: ladina tähtede jooksud väljaspool `<f>`-i, rea kaupa,
 *   esimesest tähest viimaseni. Jooksu katkestab `<f>`-i sisu, reavahetus ja
 *   mitteladina täht (kreeka/heebrea ei ole kumbki kiri); tühik, number,
 *   kirjavahemärk ja tägi-token jooksu ei katkesta.
 */
export function minorityRanges(text: string, mode: ScriptMode): ScriptRange[] {
  const { inF, inTag, fRanges } = scan(text);
  if (mode === 'antiqua') return fRanges.filter(r => r.to > r.from);
  const out: ScriptRange[] = [];
  let start = -1;
  let lastLetterEnd = -1;
  const flush = () => {
    if (start !== -1) out.push({ from: start, to: lastLetterEnd });
    start = -1;
    lastLetterEnd = -1;
  };
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inTag[i]) continue;
    if (inF[i] || ch === '\n') { flush(); continue; }
    if (LATIN.test(ch)) {
      if (start === -1) start = i;
      lastLetterEnd = i + 1;
    } else if (/\p{L}/u.test(ch)) {
      flush(); // kreeka, heebrea jne
    }
  }
  flush();
  return out;
}

// --- CodeMirrori laiendus ---

interface ScriptModeState extends PageScript {
  /** Toimetaja pööras režiimi käsitsi (vaate olek, ei salvestata). */
  manual: boolean;
}

/** Arvuta enamus uuesti praegusest tekstist (nt pärast salvestamist). */
export const recomputeScriptMode = StateEffect.define<null>();
/** Pööra kuvarežiim käsitsi (alumise riba silt). */
export const toggleScriptMode = StateEffect.define<null>();

function shouldRecompute(tr: Transaction): boolean {
  return tr.annotation(pageSwapAnnotation) === true || tr.effects.some(e => e.is(recomputeScriptMode));
}

export const scriptModeField = StateField.define<ScriptModeState>({
  create: state => ({ ...pageScript(state.doc.toString()), manual: false }),
  update(value, tr) {
    let next = value;
    if (shouldRecompute(tr)) next = { ...pageScript(tr.newDoc.toString()), manual: false };
    else if (tr.docChanged && !value.hasF) {
      // Silt ilmub esimese `<f>`-iga (märgendamata fraktuurleht), režiim ei pöördu.
      const hasF = tr.newDoc.toString().includes('<f>');
      if (hasF) next = { ...value, hasF };
    }
    for (const e of tr.effects) {
      if (e.is(toggleScriptMode)) {
        next = { ...next, mode: next.mode === 'fraktur' ? 'antiqua' : 'fraktur', manual: true };
      }
    }
    return next;
  },
});

const minorityMark = Decoration.mark({ class: 'vutt-script-minority' });

function buildDecorations(text: string, mode: ScriptMode): DecorationSet {
  return Decoration.set(minorityRanges(text, mode).map(r => minorityMark.range(r.from, r.to)), true);
}

const scriptDecoField = StateField.define<DecorationSet>({
  create: state => buildDecorations(state.doc.toString(), state.field(scriptModeField).mode),
  update(deco, tr) {
    const modeChanged = tr.startState.field(scriptModeField).mode !== tr.state.field(scriptModeField).mode;
    if (!tr.docChanged && !modeChanged) return deco;
    return buildDecorations(tr.newDoc.toString(), tr.state.field(scriptModeField).mode);
  },
  // Kõrgem prioriteet = SISEMINE span: hall jooks poolitub märgendusmärkide sees, mitte
  // vastupidi. Muidu lõhub ta lehe tähistuse (`<catch>II. Hu-</catch>`: hall katab ainult
  // tähti) kaheks span'iks ja kumbki saab oma `::before`-saki (Becker lk 76, 2026-11-02).
  provide: f => Prec.high(EditorView.decorations.from(f)),
});

export function scriptModeExtension(): Extension {
  return [scriptModeField, scriptDecoField];
}
