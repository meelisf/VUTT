// Lihtne reapõhine diff (LCS) kahe teksti vahel. Kasutatakse kommentaaride
// varasema versiooni ja praeguse seisu võrdluseks (sama punane/roheline stiil
// nagu HistoryTab/Review git-diffidel). Komentaarid on lühikesed → O(m·n) sobib.

export type DiffLineType = 'add' | 'del' | 'context';

export interface DiffLine {
  type: DiffLineType;
  text: string;
}

/**
 * Reapõhine diff vanast (`oldText`) uue (`newText`) suunas.
 * `del` = ainult vanas (eemaldatud), `add` = ainult uues (lisatud),
 * `context` = mõlemas (muutmata).
 */
export function lineDiff(oldText: string, newText: string): DiffLine[] {
  // Tühi string = null read (mitte üks tühi rida), et diff ei näitaks tühja müra.
  const a = oldText ? oldText.split('\n') : [];
  const b = newText ? newText.split('\n') : [];
  const m = a.length;
  const n = b.length;

  // LCS pikkuste tabel (tagant ettepoole).
  const lcs: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = m - 1; i >= 0; i--) {
    for (let j = n - 1; j >= 0; j--) {
      lcs[i][j] = a[i] === b[j]
        ? lcs[i + 1][j + 1] + 1
        : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }

  const out: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < m && j < n) {
    if (a[i] === b[j]) {
      out.push({ type: 'context', text: a[i] });
      i++; j++;
    } else if (lcs[i + 1][j] >= lcs[i][j + 1]) {
      out.push({ type: 'del', text: a[i] });
      i++;
    } else {
      out.push({ type: 'add', text: b[j] });
      j++;
    }
  }
  while (i < m) { out.push({ type: 'del', text: a[i] }); i++; }
  while (j < n) { out.push({ type: 'add', text: b[j] }); j++; }
  return out;
}
