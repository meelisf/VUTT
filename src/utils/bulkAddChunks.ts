export interface AddChunk {
  files: File[];
  afterPageNum: number;
}

// Tükeldab failid partiideks (arv JA maht) ja arvutab iga partii sihtpositsiooni.
// after=-1 (lõppu): iga partii jääb -1. Muidu: partii lisab K lehte positsiooni P
// järele → järgmine partii after = P+K.
export function planChunks(
  files: File[],
  afterPageNum: number,
  maxFiles: number,
  maxBytes: number,
): AddChunk[] {
  const chunks: AddChunk[] = [];
  let current: File[] = [];
  let currentBytes = 0;
  let pos = afterPageNum;

  const flush = () => {
    if (current.length === 0) return;
    chunks.push({ files: current, afterPageNum: pos });
    if (afterPageNum !== -1) pos += current.length;   // P+K
    current = [];
    currentBytes = 0;
  };

  for (const file of files) {
    const wouldExceed =
      current.length >= maxFiles ||
      (current.length > 0 && currentBytes + file.size > maxBytes);
    if (wouldExceed) flush();
    current.push(file);
    currentBytes += file.size;
  }
  flush();
  return chunks;
}
