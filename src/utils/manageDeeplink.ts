/** Workspace → /manage deep-link konkreetsele lehele. */
export function buildManageLink(workId: string, pageNum: number): string {
  return `/work/${workId}/manage?focus=${pageNum}`;
}

/** Parsib ?focus= väärtuse. Lubatud ainult positiivne täisarv, muidu null. */
export function parseFocusParam(raw: string | null): number | null {
  if (raw == null) return null;
  // Range: ainult puhas positiivne täisarv (mitte "12.5", "12abc", "-1", "0")
  if (!/^[1-9][0-9]*$/.test(raw.trim())) return null;
  const n = Number(raw.trim());
  return Number.isInteger(n) && n > 0 ? n : null;
}

/** /manage → Workspace tagasitee. Parima-püüde: focus või leht 1. */
export function buildBackToEditorPath(workId: string, focus: number | null): string {
  return `/work/${workId}/${focus ?? 1}`;
}
