// renderVuttMarkup.ts — VUTT XML märgenduse konvertimine HTML-iks mobiilivaate jaoks.
// Kuvab tägid nähtamatult: bold, italic, cs, marginalia, footnote, pagebreak.

export function renderVuttMarkup(text: string): string {
  let html = text
    .replace(/&/g, '&amp;')
    // Escape kõik < mis EI alusta lubatud VUTT-tägi (avav/sulgev) → kaitse HTML-injektsiooni
    // eest (security_review Leid A). Kasutaja sisestatud <span onclick=...>, <img onerror=...>
    // jne muutuvad &lt;-ks; ainult VUTT-tägid (b,i,cs,m,hi,fn,pb,annN) jäävad töötlemiseks alles.
    .replace(/<(?!\/?(?:b|i|cs|m|hi|fn|pb|ann\d+)\b)/g, '&lt;')
    // <pb/> — leheküljevahetus
    .replace(/<pb\/>/g, '<span class="block text-center text-gray-300 text-xs my-1 select-none">── lk ──</span>')
    // <fn>n</fn> — joonealune viide superscriptina
    .replace(/<fn>(\d+)<\/fn>/g, '<sup class="text-gray-400 text-[10px] ml-0.5">$1</sup>')
    // Paaristägid
    .replace(/<b>([\s\S]*?)<\/b>/g, '<strong>$1</strong>')
    .replace(/<i>([\s\S]*?)<\/i>/g, '<em>$1</em>')
    .replace(/<cs>([\s\S]*?)<\/cs>/g, '<span class="italic tracking-wide">$1</span>')
    // <m>...</m> — marginaalia plokk-kaardina: taane, väiksem kiri, vasak ääris.
    // Sisemine märgendus (<i>, <cs> jne) renderdub tavaliste reeglitega.
    .replace(/<m>([\s\S]*?)<\/m>/g, '<span class="block text-[0.85em] leading-snug text-stone-600 border-l-2 border-stone-300 pl-2 my-1">$1</span>')
    .replace(/<hi>([\s\S]*?)<\/hi>/g, '<mark class="bg-yellow-100">$1</mark>')
    // <annN>...</annN> — tekstiannotatsioon: sama visuaal mis editoris (.vutt-ann),
    // ilma interaktiivsuseta. ID-d peavad klappima (\1); orvud/valepaarid koristab
    // allolev tundmatute tägide strip (sisu säilib).
    .replace(/<ann(\d+)>([\s\S]*?)<\/ann\1>/g, '<mark class="bg-yellow-100 border-b-2 border-yellow-500 rounded-sm">$2</mark>');

  // Eemaldame ülejäänud tundmatud VUTT-tägid; meie sisestatud HTML-elemendid (strong, em, span,
  // mark, sup) on whitelistis ja jäävad puutumatuks.
  html = html.replace(/<\/?(?!(?:strong|em|span|mark|sup|hr)\b)[a-z][a-z0-9]*[^>]*>/g, '');

  return html;
}
