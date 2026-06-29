// Puhtad tekstiteisendused MarkdownEditor jaoks. DOM-vabad, unit-testitavad.

export interface SelectionResult {
  text: string;
  start: number;
  end: number;
}

export interface LinkPrefill {
  linkText: string;
  url: string;
  focusField: 'text' | 'url';
}

// Mähib valiku sümmeetrilise markeriga (** paksule, * kursiivile).
// Tühja valiku korral lisab markeri + kohahoidja ja valib kohahoidja.
export function applyWrap(
  text: string,
  start: number,
  end: number,
  marker: string,
  placeholder: string,
): SelectionResult {
  const selected = text.slice(start, end);
  if (selected.length === 0) {
    const inserted = `${marker}${placeholder}${marker}`;
    const newText = text.slice(0, start) + inserted + text.slice(end);
    const selStart = start + marker.length;
    return { text: newText, start: selStart, end: selStart + placeholder.length };
  }
  const inserted = `${marker}${selected}${marker}`;
  const newText = text.slice(0, start) + inserted + text.slice(end);
  const innerStart = start + marker.length;
  return { text: newText, start: innerStart, end: innerStart + selected.length };
}

// Lisab rea-prefiksi (nt "## " või "- ") iga valikus oleva rea algusesse.
// skipIfPresent: jätab vahele read, mis juba prefiksiga algavad (väldib topeldamist).
export function applyLinePrefix(
  text: string,
  start: number,
  end: number,
  prefix: string,
  options?: { skipIfPresent?: boolean },
): SelectionResult {
  const lineStart = text.lastIndexOf('\n', start - 1) + 1; // 0 kui puudub
  let lineEnd = text.indexOf('\n', end);
  if (lineEnd === -1) lineEnd = text.length;

  const block = text.slice(lineStart, lineEnd);
  const newBlock = block
    .split('\n')
    .map(line => (options?.skipIfPresent && line.startsWith(prefix) ? line : prefix + line))
    .join('\n');

  const newText = text.slice(0, lineStart) + newBlock + text.slice(lineEnd);
  return { text: newText, start: lineStart, end: lineStart + newBlock.length };
}

const URL_RE = /^(https?:\/\/|www\.)/i;

export function looksLikeUrl(s: string): boolean {
  return URL_RE.test(s.trim());
}

// Eeltäidab lingi-popoveri praeguse valiku põhjal.
export function linkPrefillFromSelection(selected: string): LinkPrefill {
  const trimmed = selected.trim();
  if (trimmed && looksLikeUrl(trimmed)) {
    return { linkText: '', url: trimmed, focusField: 'text' };
  }
  return { linkText: selected, url: '', focusField: trimmed ? 'url' : 'text' };
}

// Normaliseerib lingi-URL-i: protokollita www.-aadressile lisab https://,
// et markdown ei tekitaks katkist suhtelist linki ([x](www.foo) → href="www.foo").
export function normalizeLinkUrl(url: string): string {
  const trimmed = url.trim();
  if (/^www\./i.test(trimmed)) return `https://${trimmed}`;
  return trimmed;
}

// Lisab markdown-lingi [label](url), asendades valiku. Kursor jääb lingi järele.
export function insertLink(
  text: string,
  start: number,
  end: number,
  label: string,
  url: string,
): SelectionResult {
  const safeUrl = normalizeLinkUrl(url);
  const safeLabel = label || safeUrl || 'link';
  const inserted = `[${safeLabel}](${safeUrl})`;
  const newText = text.slice(0, start) + inserted + text.slice(end);
  const cursor = start + inserted.length;
  return { text: newText, start: cursor, end: cursor };
}
