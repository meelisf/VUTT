/**
 * Teose halduse „Osad" vahekaart (#464, ADR 0057). Täislaiuses kaks vaadet:
 * „Lehed" (ruudustik suuruse liuguriga, valik + osa märgid) ja „Sisukord" (tabel).
 * Vorm on hõljuvas lohistatavas paneelis ilma taustakihita, valikutegevused
 * alumisel ribal. Osad muutuvad ainult
 * /works/{id}/parts otspunktidega; salvestamata muudatuste kaitse elab WorkManage'is
 * (useBlocker vajab andmeruuterit) ja jõuab siia runGuarded/saveRef kaudu.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { LayoutGrid, ListOrdered } from 'lucide-react';
import type { WorkPageInfo } from '../../../services/workApi';
import {
  changePartPages, createPart, deletePart, listParts, updatePart, type WorkPart,
} from '../../../services/workPartsApi';
import { draftFromPart, emptyDraft, pageBadges, partFromDraft, sharedStems, sortParts, type PartDraft } from '../partsModel';
import PartsGrid from './PartsGrid';
import PartsList from './PartsList';
import PartForm from './PartForm';
import PartPanel from './PartPanel';
import { usePersonSources } from '../../../hooks/usePersonSources';
import { getLangCode } from '../../../utils/getLangCode';

const THUMB_KEY = 'vutt_parts_thumb';
const THUMB_MIN = 100;
const THUMB_MAX = 360;

// Pisipildi suurus on vaate mugavus: tõrge = vaikeväärtus.
function readThumbSize(): number {
  try {
    const n = Number(localStorage.getItem(THUMB_KEY));
    return n >= THUMB_MIN && n <= THUMB_MAX ? n : 160;
  } catch {
    return 160;
  }
}

interface Props {
  workId: string;
  pages: WorkPageInfo[];
  token: string | null;
  imageToken: { exp: number; sig: string } | null;
  thumbCacheBust: number;
  onDirtyChange: (dirty: boolean) => void;
  runGuarded: (fn: () => void) => void;
  /** WorkManage'i salvestamata-dialoog kutsub seda „Salvesta ja jätka" peale. */
  saveRef: React.MutableRefObject<() => Promise<boolean>>;
}

type Editing = { id: string | null; pages: string[] } | null;

const PartsTab: React.FC<Props> = ({ workId, pages, token, imageToken, thumbCacheBust, onDirtyChange, runGuarded, saveRef }) => {
  const { t, i18n } = useTranslation(['workspace']);
  const { authors, peopleRegister } = usePersonSources(token, getLangCode(i18n.language));
  const [view, setView] = useState<'pages' | 'toc'>('pages');
  const [thumbSize, setThumbSize] = useState(readThumbSize);
  const [parts, setParts] = useState<WorkPart[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [anchor, setAnchor] = useState<string | null>(null);
  const [editing, setEditing] = useState<Editing>(null);
  const [draft, setDraft] = useState<PartDraft>(emptyDraft());
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const stems = useMemo(() => pages.map(p => p.base_name), [pages]);
  const pageNums = useMemo(() => new Map(pages.map(p => [p.base_name, p.page_num])), [pages]);
  const sorted = useMemo(() => sortParts(parts, stems), [parts, stems]);
  const badges = useMemo(() => pageBadges(parts, stems), [parts, stems]);
  const active = editing?.id ? parts.find(p => p.id === editing.id) ?? null : null;

  const reload = useCallback(async () => {
    try {
      setParts(await listParts(workId, token));
    } catch (e) {
      setError((e as Error).message);
    }
  }, [workId, token]);

  useEffect(() => { void reload(); }, [reload]);
  useEffect(() => { onDirtyChange(dirty); }, [dirty, onDirtyChange]);

  const editDraft = (d: PartDraft) => { setDraft(d); setDirty(true); };

  const openPart = (id: string) => runGuarded(() => {
    const p = parts.find(x => x.id === id);
    if (!p) return;
    setEditing({ id, pages: p.pages });
    setDraft(draftFromPart(p));
    setDirty(false);
    setError(null);
  });

  const toggle = (stem: string, shift: boolean) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (shift && anchor) {
        const [a, b] = [stems.indexOf(anchor), stems.indexOf(stem)].sort((x, y) => x - y);
        stems.slice(a, b + 1).forEach(s => next.add(s));
      } else if (next.has(stem)) {
        next.delete(stem);
      } else {
        next.add(stem);
      }
      return next;
    });
    if (!shift) setAnchor(stem);
  };

  const startNew = () => runGuarded(() => {
    setEditing({ id: null, pages: stems.filter(s => selected.has(s)) });
    setDraft(emptyDraft());
    setDirty(false);   // puutumata uus osa ei ole muudatus — muidu küsiks kaitse tühja osa loomist
    setError(null);
  });

  const closePanel = () => runGuarded(() => {
    setEditing(null);
    setDirty(false);
    setError(null);
  });

  const changeThumbSize = (n: number) => {
    setThumbSize(n);
    try { localStorage.setItem(THUMB_KEY, String(n)); } catch { /* mugavus */ }
  };

  const fail = (e: unknown) => setError((e as Error).message || String(e));

  const save = useCallback(async (): Promise<boolean> => {
    if (!editing) return true;
    setBusy(true);
    setError(null);
    try {
      // Uus osa: paneel on mittemodaalne, seega avamise järel valitud lehed lähevad kaasa.
      const newPages = stems.filter(s => editing.pages.includes(s) || selected.has(s));
      const input = partFromDraft(draft, editing.id ? (active?.pages ?? editing.pages) : newPages);
      const saved = editing.id
        ? await updatePart(workId, editing.id, input, token)
        : await createPart(workId, input, token);
      await reload();
      setEditing({ id: saved.id, pages: saved.pages });
      setDraft(draftFromPart(saved));
      setDirty(false);
      if (!editing.id) setSelected(new Set());
      return true;
    } catch (e) {
      fail(e);
      return false;
    } finally {
      setBusy(false);
    }
  }, [editing, draft, active, workId, token, reload, stems, selected]);

  useEffect(() => { saveRef.current = save; }, [save, saveRef]);

  // Sulgemisel (vahekaardi vahetus „Loobu" järel): lipp maha ja saveRef tühjaks —
  // muidu jääks WorkManage'i kaitse igaveseks aktiivseks ja „Salvesta ja jätka"
  // kutsuks suletud komponendi vana sulgurit (looks loobutud osa).
  useEffect(() => () => {
    onDirtyChange(false);
    saveRef.current = async () => true;
  }, [onDirtyChange, saveRef]);

  const remove = async () => {
    if (!editing?.id) return;
    setBusy(true);
    setError(null);
    try {
      await deletePart(workId, editing.id, token);
      await reload();
      setEditing(null);
      setDirty(false);
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  };

  const changePages = async (mode: 'add' | 'remove') => {
    if (!editing?.id) return;
    const chosen = stems.filter(s => selected.has(s));
    setBusy(true);
    setError(null);
    try {
      await changePartPages(workId, editing.id, mode === 'add' ? chosen : [], mode === 'remove' ? chosen : [], token);
      await reload();
      setSelected(new Set());
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  };

  const activeStems = useMemo(() => new Set(active?.pages ?? editing?.pages ?? []), [active, editing]);
  const shared = active ? [...sharedStems(active, parts).keys()] : [];

  const segBtn = (on: boolean) =>
    `flex items-center gap-1.5 px-3 py-1.5 text-sm ${on ? 'bg-primary-600 text-white' : 'bg-white text-gray-700 hover:bg-gray-50'}`;
  const panelTitle = editing
    ? (editing.id ? draft.title || t(`manage.parts.kinds.${draft.kind}`) : t('manage.parts.newPart'))
    : '';

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <div className="inline-flex overflow-hidden rounded border border-gray-300" role="group">
          <button type="button" aria-pressed={view === 'pages'} onClick={() => setView('pages')} className={segBtn(view === 'pages')}>
            <LayoutGrid size={14} /> {t('manage.parts.viewPages')}
          </button>
          <button type="button" aria-pressed={view === 'toc'} onClick={() => setView('toc')} className={`${segBtn(view === 'toc')} border-l border-gray-300`}>
            <ListOrdered size={14} /> {t('manage.parts.viewToc')} <span className="tabular-nums opacity-70">({parts.length})</span>
          </button>
        </div>
        {view === 'pages' && (
          <label className="flex items-center gap-2 text-xs text-gray-500">
            <LayoutGrid size={12} />
            <input
              type="range"
              min={THUMB_MIN}
              max={THUMB_MAX}
              step={20}
              value={thumbSize}
              onChange={e => changeThumbSize(Number(e.target.value))}
              aria-label={t('manage.parts.thumbSize')}
              className="w-32 accent-primary-600"
            />
            <LayoutGrid size={16} />
          </label>
        )}
        {!editing && error && <p className="text-sm text-red-600">{t('manage.parts.error', { message: error })}</p>}
      </div>

      {view === 'pages' ? (
        <>
          {parts.length === 0 && <p className="text-sm text-gray-500">{t('manage.parts.empty')}</p>}
          <PartsGrid
            workId={workId}
            pages={pages}
            badges={badges}
            selected={selected}
            activeStems={activeStems}
            imageToken={imageToken}
            thumbCacheBust={thumbCacheBust}
            onToggle={toggle}
            onOpenPart={openPart}
            thumbSize={thumbSize}
          />
        </>
      ) : (
        <PartsList parts={sorted} pageNums={pageNums} activeId={editing?.id ?? null} onSelect={openPart} />
      )}

      {selected.size > 0 && (
        <div className="sticky bottom-0 z-[1100] -mx-1 flex flex-wrap items-center gap-2 rounded-t-lg border border-primary-200 bg-white/95 px-3 py-2 text-sm shadow-[0_-4px_16px_rgba(0,0,0,0.08)] backdrop-blur">
          <span className="font-medium text-primary-800">{t('manage.parts.selected', { count: selected.size })}</span>
          <button type="button" onClick={startNew} disabled={busy}
            className="rounded bg-primary-600 px-2.5 py-1 text-white hover:bg-primary-700 disabled:bg-gray-300">
            {t('manage.parts.create')}
          </button>
          {editing?.id && (
            <>
              <button type="button" onClick={() => changePages('add')} disabled={busy}
                className="rounded border border-primary-300 bg-white px-2.5 py-1 text-primary-700 hover:bg-primary-100">
                {t('manage.parts.addToPart')}
              </button>
              <button type="button" onClick={() => changePages('remove')} disabled={busy}
                className="rounded border border-gray-300 bg-white px-2.5 py-1 text-gray-700 hover:bg-gray-100">
                {t('manage.parts.removeFromPart')}
              </button>
            </>
          )}
          <button type="button" onClick={() => { setSelected(new Set()); setAnchor(null); }}
            className="ml-auto rounded px-2.5 py-1 text-gray-600 hover:bg-gray-100">
            {t('manage.parts.clearSelection')}
          </button>
        </div>
      )}

      {editing && (
        <PartPanel title={panelTitle} onClose={closePanel}>
          <PartForm
            isNew={!editing.id}
            draft={draft}
            onDraft={editDraft}
            otherParts={parts.filter(p => p.id !== editing.id && p.kind !== 'attachment')}
            sharedStems={shared}
            error={error}
            busy={busy}
            token={token}
            workId={workId}
            authors={authors}
            peopleRegister={peopleRegister}
            onSave={() => { void save(); }}
            onDelete={() => { void remove(); }}
          />
        </PartPanel>
      )}
    </div>
  );
};

export default PartsTab;
