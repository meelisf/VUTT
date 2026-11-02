// renderVuttMarkup.ts — VUTT XML märgenduse konvertimine HTML-iks mobiilivaate jaoks.
// Kuvab tägid nähtamatult: bold, italic, fraktuur, marginalia, lisandus, lehe tähistus, footnote, pagebreak.
import { RENDER_ALLOWED_RE } from '../markup/consumers';
import { minorityRanges, pageScript, type ScriptMode, type ScriptRange } from '../components/editor/scriptMode';

// Kirjastiili vahemike piirid (Unicode'i eraalade märgid): elavad üle escape'i ja
// tägi-asenduste ning muutuvad lõpus <span>-iks.
const MIN_OPEN = '\uE000';
const MIN_CLOSE = '\uE001';

/** Lõikab vahemikud tägi-tokenite kohalt, et <span> ei ristuks <em>/<strong>-iga. */
function splitAtTags(text: string, ranges: ScriptRange[]): ScriptRange[] {
  const out: ScriptRange[] = [];
  for (const r of ranges) {
    let from = r.from;
    for (const m of text.slice(r.from, r.to).matchAll(/<\/?[a-z]+\d*\/?>/g)) {
      const at = r.from + m.index;
      if (at > from) out.push({ from, to: at });
      from = at + m[0].length;
    }
    if (r.to > from) out.push({ from, to: r.to });
  }
  return out;
}

/**
 * @param mode lehe kirjastiil (ADR 0077, 2a). Puudub → arvutatakse tekstist endast.
 *   Marginaaliakaart annab lehe režiimi, sest kaardi sisu üksi ei esinda lehte.
 */
export function renderVuttMarkup(text: string, mode?: ScriptMode): string {
  // Vähemuskiri halli taustaga (sama klass mis redaktoris); <f> ise kujundust ei anna.
  const ranges = splitAtTags(text, minorityRanges(text, mode ?? pageScript(text).mode));
  let marked = text;
  for (const r of [...ranges].reverse()) {
    marked = marked.slice(0, r.from) + MIN_OPEN + marked.slice(r.from, r.to) + MIN_CLOSE + marked.slice(r.to);
  }
  let html = marked
    .replace(/&/g, '&amp;')
    // Escape kõik < mis EI alusta registri VUTT-tägi (ADR 0071) → kaitse HTML-injektsiooni
    // eest (security_review Leid A). Kasutaja sisestatud <span onclick=...>, <img onerror=...>
    // jne muutuvad &lt;-ks; ainult registri tägid jäävad töötlemiseks alles.
    .replace(RENDER_ALLOWED_RE, '&lt;')
    // <pb/> — leheküljevahetus
    .replace(/<pb\/>/g, '<span class="block text-center text-gray-300 text-xs my-1 select-none">── lk ──</span>')
    // <fn>n</fn> — joonealune viide superscriptina
    .replace(/<fn>(\d+)<\/fn>/g, '<sup class="text-gray-400 text-[10px] ml-0.5">$1</sup>')
    // Paaristägid
    .replace(/<b>([\s\S]*?)<\/b>/g, '<strong>$1</strong>')
    .replace(/<i>([\s\S]*?)<\/i>/g, '<em>$1</em>')
    .replace(/<\/?f>/g, '')
    // <m>...</m> — marginaalia plokk-kaardina: taane, väiksem kiri, vasak ääris.
    // Sisemine märgendus (<i>, <f> jne) renderdub tavaliste reeglitega.
    .replace(/<m>([\s\S]*?)<\/m>/g, '<span class="block text-[0.85em] leading-snug text-stone-600 border-l-2 border-stone-300 pl-2 my-1">$1</span>')
    .replace(/<hi>([\s\S]*?)<\/hi>/g, '<mark class="bg-yellow-100">$1</mark>')
    // <add>...</add> — lisandus oma lisamiskohas (ADR 0067), sama klass mis redaktoris
    .replace(/<add>([\s\S]*?)<\/add>/g, '<span class="vutt-add">$1</span>')
    // Lehe tähistus (ADR 0070): sama klass mis redaktoris
    .replace(/<(fw|sig|catch|rh)>([\s\S]*?)<\/\1>/g, '<span class="vutt-pm vutt-pm-$1">$2</span>')
    // <annN>...</annN> — tekstiannotatsioon: sama visuaal mis editoris (.vutt-ann),
    // ilma interaktiivsuseta. ID-d peavad klappima (\1); orvud/valepaarid koristab
    // allolev tundmatute tägide strip (sisu säilib).
    .replace(/<ann(\d+)>([\s\S]*?)<\/ann\1>/g, '<mark class="bg-yellow-100 border-b-2 border-yellow-500 rounded-sm">$2</mark>');

  // Eemaldame ülejäänud tundmatud VUTT-tägid; meie sisestatud HTML-elemendid (strong, em, span,
  // mark, sup) on whitelistis ja jäävad puutumatuks.
  html = html.replace(/<\/?(?!(?:strong|em|span|mark|sup|hr)\b)[a-z][a-z0-9]*[^>]*>/g, '');
  html = html.split(MIN_OPEN).join('<span class="vutt-script-minority">').split(MIN_CLOSE).join('</span>');

  return html;
}
