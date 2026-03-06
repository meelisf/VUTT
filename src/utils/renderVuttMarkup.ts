// renderVuttMarkup.ts — VUTT XML märgenduse konvertimine HTML-iks mobiilivaate jaoks.
// Kuvab tägid nähtamatult: bold, italic, cs, marginalia, footnote, pagebreak.

export function renderVuttMarkup(text: string): string {
  let html = text
    .replace(/&/g, '&amp;')
    // <pb/> — leheküljevahetus
    .replace(/<pb\/>/g, '<span class="block text-center text-gray-300 text-xs my-1 select-none">── lk ──</span>')
    // <fn>n</fn> — joonealune viide superscriptina
    .replace(/<fn>(\d+)<\/fn>/g, '<sup class="text-gray-400 text-[10px] ml-0.5">$1</sup>')
    // Paaristägid
    .replace(/<b>([\s\S]*?)<\/b>/g, '<strong>$1</strong>')
    .replace(/<i>([\s\S]*?)<\/i>/g, '<em>$1</em>')
    .replace(/<cs>([\s\S]*?)<\/cs>/g, '<span class="italic tracking-wide">$1</span>')
    .replace(/<m>([\s\S]*?)<\/m>/g, '<span class="text-gray-400 text-sm border-l-2 border-gray-200 pl-1">$1</span>')
    .replace(/<hi>([\s\S]*?)<\/hi>/g, '<mark class="bg-yellow-100">$1</mark>');

  // Eemaldame ülejäänud tundmatud VUTT-tägid; meie sisestatud HTML-elemendid (strong, em, span,
  // mark, sup) on whitelistis ja jäävad puutumatuks.
  html = html.replace(/<\/?(?!(?:strong|em|span|mark|sup|hr)\b)[a-z][a-z0-9]*[^>]*>/g, '');

  return html;
}
