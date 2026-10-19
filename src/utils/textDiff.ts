/**
 * Sõnataseme diff kandidaatteksti ülevaatuseks (#641; sama vajadus #577 re-OCR-il).
 * Märgendus (`<i>`, `</m>`, `<pb/>`) ja tühemik on omaette tokenid, nii et tägi
 * lisamine/eemaldamine paistab eraldi. Ilma sõltuvuseta: LCS ühise alguse ja lõpu
 * ärakärpimise järel; liiga suure keskosa korral rea tasemel.
 */
export type DiffOp = { op: 'eq' | 'del' | 'ins'; text: string };

const TOKEN_RE = /\s+|<[^<>\s]*>|<|[^\s<]+/g;
const MAX_CELLS = 4_000_000;

const tokenize = (s: string) => s.match(TOKEN_RE) ?? [];
const lines = (s: string) => s.match(/[^\n]*\n|[^\n]+$/g) ?? [];

function push(out: DiffOp[], op: DiffOp['op'], text: string) {
  if (!text) return;
  const last = out[out.length - 1];
  if (last && last.op === op) last.text += text;
  else out.push({ op, text });
}

function lcs(a: string[], b: string[], out: DiffOp[]) {
  const n = a.length, m = b.length;
  const w = m + 1;
  const t = new Uint32Array((n + 1) * w);
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      t[i * w + j] = a[i] === b[j] ? t[(i + 1) * w + j + 1] + 1 : Math.max(t[(i + 1) * w + j], t[i * w + j + 1]);
    }
  }
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) { push(out, 'eq', a[i]); i++; j++; }
    else if (t[(i + 1) * w + j] >= t[i * w + j + 1]) { push(out, 'del', a[i]); i++; }
    else { push(out, 'ins', b[j]); j++; }
  }
  while (i < n) push(out, 'del', a[i++]);
  while (j < m) push(out, 'ins', b[j++]);
}

function diffTokens(a: string[], b: string[], out: DiffOp[], fallback: boolean) {
  let s = 0;
  while (s < a.length && s < b.length && a[s] === b[s]) push(out, 'eq', a[s++]);
  let ea = a.length, eb = b.length;
  while (ea > s && eb > s && a[ea - 1] === b[eb - 1]) { ea--; eb--; }
  const midA = a.slice(s, ea), midB = b.slice(s, eb);
  if (fallback && (midA.length + 1) * (midB.length + 1) > MAX_CELLS) {
    // Keskosa on liiga suur sõnade LCS-iks: võrdle ridu.
    diffTokens(lines(midA.join('')), lines(midB.join('')), out, false);
  } else if ((midA.length + 1) * (midB.length + 1) > MAX_CELLS) {
    push(out, 'del', midA.join(''));
    push(out, 'ins', midB.join(''));
  } else {
    lcs(midA, midB, out);
  }
  for (let k = ea; k < a.length; k++) push(out, 'eq', a[k]);
}

export function diffWords(a: string, b: string): DiffOp[] {
  const out: DiffOp[] = [];
  diffTokens(tokenize(a), tokenize(b), out, true);
  return out;
}
