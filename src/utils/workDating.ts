/** Dates as written on the source: no timezone or implicit calendar conversion. */
export interface WorkDating {
  start: string;
  end?: string;
  kind?: 'span' | 'uncertain';
  calendar?: 'julian' | 'gregorian' | 'swedish';
  approximate?: boolean;
  note?: string;
  source_text?: string;
}

export function parsePartialDate(value: string, calendar?: string): number[] | null {
  if (!/^\d{3,4}(?:-\d{2}(?:-\d{2})?)?$/.test(value)) return null;
  const parts = value.split('-').map(Number);
  const [y, m, d] = parts;
  if (y < 1 || (m !== undefined && (m < 1 || m > 12))) return null;
  // Unknown calendars allow Julian leap days; Sweden had 30 February 1712.
  const leap = !(calendar === 'swedish' && y === 1700) && y % 4 === 0 && (calendar !== 'gregorian' || y % 100 !== 0 || y % 400 === 0);
  const days = m === 2 ? ((!calendar || calendar === 'swedish') && y === 1712 ? 30 : leap ? 29 : 28) : [4, 6, 9, 11].includes(m) ? 30 : 31;
  if (d !== undefined && (d < 1 || d > days)) return null;
  return parts;
}

export function dateBound(value: string | number | undefined, upper = false): number | null {
  if (value === undefined || value === '') return null;
  const parts = parsePartialDate(String(value));
  if (!parts) return null;
  const [y, m, d] = parts;
  // 31 is an inclusive search sentinel, not an asserted date.
  return y * 10000 + (m ?? (upper ? 12 : 1)) * 100 + (d ?? (upper ? 31 : 1));
}

/** Only unambiguous numeric legacy dates are inferred; prose remains untouched. */
export function parseDatingText(raw: string): WorkDating | null {
  const s = raw.trim();
  const endpoint = (v: string): string | null => {
    if (parsePartialDate(v)) return v;
    const m = v.match(/^(\d{1,2})[.-](\d{1,2})[.-](\d{4})$/);
    const iso = m ? `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}` : '';
    return parsePartialDate(iso) ? iso : null;
  };
  const one = endpoint(s);
  if (one) return { start: one };
  const pair = s.split(/\s+[–—-]\s+|[–—/]/);
  if (pair.length === 2) {
    const start = endpoint(pair[0].trim()), end = endpoint(pair[1].trim());
    if (start && end && dateBound(start)! <= dateBound(end, true)!) return { start, end };
  }
  const years = s.match(/^(\d{3,4})-(\d{3,4})$/);
  if (years && Number(years[1]) <= Number(years[2])) return { start: years[1], end: years[2] };
  return null;
}

export function datingText(dating: WorkDating): string {
  return dating.start + (dating.end ? ` / ${dating.end}` : '');
}

export function datingError(dating?: WorkDating | null): boolean {
  return !!dating && (!parsePartialDate(dating.start, dating.calendar) ||
    (dating.end !== undefined && (!parsePartialDate(dating.end, dating.calendar) || dateBound(dating.start)! > dateBound(dating.end, true)!)));
}

export function hasImpreciseDating(dating: WorkDating | null | undefined, display?: string | null): boolean {
  const d = dating ?? parseDatingText(display || '');
  return !d || !!d.approximate || d.kind === 'uncertain' || d.start.split('-').length < 3 || (!!d.end && d.end.split('-').length < 3);
}
