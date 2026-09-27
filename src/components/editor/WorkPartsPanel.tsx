/**
 * Teose osade sisukord töölaua „Info ja annotatsioonid" vahekaardil (#464, ADR 0057),
 * teose info all. Kokkuklapitav (olek on vaate mugavus, localStorage); osadeta
 * teosel või lugemistõrke korral paneeli ei ole. Lehevahemikud on lingid lehele;
 * praegust lehte sisaldav osa on märgitud.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { ChevronDown, ChevronRight, ListOrdered } from 'lucide-react';
import { getPartsToc, type WorkPart } from '../../services/workPartsApi';
import { pageRangeList, sortParts } from '../../pages/manage/partsModel';
import { KIND_STYLE } from '../../pages/manage/parts/kindStyle';

const OPEN_KEY = 'vutt_parts_toc_open';

function readOpen(): boolean {
  try { return localStorage.getItem(OPEN_KEY) === '1'; } catch { return false; }
}

/** Kiri: kellelt → kellele; muu: isikud komaga. */
function whoLine(p: WorkPart): string {
  const named = p.creators.filter(c => c.name);
  const from = named.filter(c => c.role === 'auctor').map(c => c.name);
  const to = named.filter(c => c.role === 'addressee').map(c => c.name);
  if (p.kind === 'letter' && (from.length || to.length)) return [from.join(', '), to.join(', ')].filter(Boolean).join(' → ');
  return named.map(c => c.name).join(', ');
}

interface Props {
  workId?: string;
  token: string | null;
  currentPage: number;
}

const WorkPartsPanel: React.FC<Props> = ({ workId, token, currentPage }) => {
  const { t } = useTranslation(['workspace']);
  const [parts, setParts] = useState<WorkPart[]>([]);
  const [nums, setNums] = useState<Map<string, number>>(new Map());
  const [open, setOpen] = useState(readOpen);

  useEffect(() => {
    if (!workId) return;
    let cancelled = false;
    getPartsToc(workId, token)
      .then(r => { if (!cancelled) { setParts(r.parts); setNums(new Map(Object.entries(r.pageNumbers))); } })
      .catch(() => { if (!cancelled) setParts([]); });   // sisukord on lisainfo — tõrge peidab paneeli
    return () => { cancelled = true; };
  }, [workId, token]);

  // Järjekord lehenumbri järgi (sama mis halduse sisukorras).
  const sorted = useMemo(
    () => sortParts(parts, [...nums.entries()].sort((a, b) => a[1] - b[1]).map(([s]) => s)),
    [parts, nums],
  );

  if (!workId || parts.length === 0) return null;

  const toggle = () => {
    setOpen(o => {
      try { localStorage.setItem(OPEN_KEY, o ? '0' : '1'); } catch { /* mugavus */ }
      return !o;
    });
  };

  return (
    <div className="bg-white rounded-lg border border-gray-200 shadow-sm mb-6">
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        className="w-full flex items-center gap-2 px-5 py-3 text-left text-gray-800 hover:bg-gray-50 rounded-lg"
      >
        {open ? <ChevronDown size={16} className="text-gray-400" /> : <ChevronRight size={16} className="text-gray-400" />}
        <ListOrdered size={18} className="text-primary-600" />
        <h4 className="font-bold">{t('info.toc')} <span className="font-normal text-gray-500">({parts.length})</span></h4>
      </button>
      {open && (
        <ol className="border-t border-gray-100 divide-y divide-gray-100">
          {sorted.map((p, i) => {
            const ranges = pageRangeList(p.pages, nums);
            const here = p.pages.some(s => nums.get(s) === currentPage);
            const who = whoLine(p);
            const year = p.dating?.start?.slice(0, 4);
            return (
              <li
                key={p.id}
                aria-current={here ? 'true' : undefined}
                className={`flex gap-3 px-5 py-2.5 text-sm ${here ? 'bg-primary-50' : ''}`}
              >
                <span className={`mt-0.5 h-fit rounded px-1.5 text-[11px] font-semibold ${KIND_STYLE[p.kind]}`}
                  title={t(`manage.parts.kinds.${p.kind}`)}>
                  {i + 1}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="text-gray-900">
                    {p.title || who || t(`manage.parts.kinds.${p.kind}`)}
                    {year && <span className="ml-2 tabular-nums text-gray-500">{year}</span>}
                  </div>
                  {p.title && who && <div className="text-xs text-gray-500">{who}</div>}
                  {p.incipit && <div className="truncate text-xs italic text-gray-400">{p.incipit}</div>}
                </div>
                <div className="shrink-0 text-xs tabular-nums text-gray-500">
                  {t('info.tocPages')}{' '}
                  {ranges.map((r, k) => (
                    <React.Fragment key={r.from}>
                      {k > 0 && ', '}
                      <Link to={`/work/${workId}/${r.from}`} className="text-primary-600 hover:underline">
                        {r.from === r.to ? `${r.from}` : `${r.from}–${r.to}`}
                      </Link>
                    </React.Fragment>
                  ))}
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
};

export default WorkPartsPanel;
