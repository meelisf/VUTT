// Ploki-liigutamise puhas loogika. Sama funktsiooni kasutab eelvaade,
// "Liiguta" nupu keelamine JA draftPositions-i arvutus — nii ei lahkne UI ja submit.

export interface VisiblePage {
  filename: string;
  visiblePageNum: number; // 1-põhine positsioon nähtavas (effective) järjekorras
}

export type MovePreview =
  | { kind: 'start' }
  | { kind: 'end' }
  | { kind: 'between'; before: number; after: number };

export type BlockMoveResult =
  | { ok: true; order: string[]; preview: MovePreview }
  | { ok: false; reason: 'emptySelection' | 'anchorInSelection' | 'invalidTarget' };

export function computeBlockMoveOrder(
  visiblePages: VisiblePage[],
  selectedFilenames: Set<string>,
  targetRaw: string,
): BlockMoveResult {
  if (selectedFilenames.size === 0) return { ok: false, reason: 'emptySelection' };

  // Kõik valitud nimed peavad eksisteerima
  const known = new Set(visiblePages.map((p) => p.filename));
  for (const f of selectedFilenames) {
    if (!known.has(f)) return { ok: false, reason: 'invalidTarget' };
  }

  const pageCount = visiblePages.length;
  const block = visiblePages.filter((p) => selectedFilenames.has(p.filename));
  const rest = visiblePages.filter((p) => !selectedFilenames.has(p.filename));

  // Parsi sihtnumber: tühi → 0 (algusesse); NaN → kehtetu; kümnend trunkeeritakse
  const trimmed = targetRaw.trim();
  let target: number;
  if (trimmed === '') {
    target = 0;
  } else {
    const parsed = parseInt(trimmed, 10);
    if (Number.isNaN(parsed)) return { ok: false, reason: 'invalidTarget' };
    target = parsed;
  }

  let insertAt: number; // mitu rest-lehte jääb ploki ETTE
  let preview: MovePreview;

  if (target <= 0) {
    insertAt = 0;
    preview = { kind: 'start' };
  } else if (target > pageCount) {
    insertAt = rest.length;
    preview = { kind: 'end' };
  } else {
    const anchor = visiblePages.find((p) => p.visiblePageNum === target)!;
    if (selectedFilenames.has(anchor.filename)) {
      return { ok: false, reason: 'anchorInSelection' };
    }
    const anchorRestIdx = rest.findIndex((p) => p.filename === anchor.filename);
    insertAt = anchorRestIdx + 1;
    if (insertAt >= rest.length) {
      preview = { kind: 'end' };
    } else {
      preview = { kind: 'between', before: anchor.visiblePageNum, after: rest[insertAt].visiblePageNum };
    }
  }

  const orderPages = [...rest.slice(0, insertAt), ...block, ...rest.slice(insertAt)];
  return { ok: true, order: orderPages.map((p) => p.filename), preview };
}
