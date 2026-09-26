/**
 * Teose halduse „Osad" vahekaart (#464, ADR 0057). Vasakul lehtede ruudustik
 * (valik + osa märgid), paremal sisukord ja vorm. Osad muutuvad ainult
 * /works/{id}/parts otspunktidega; salvestamata muudatuste kaitse elab WorkManage'is
 * (useBlocker vajab andmeruuterit) ja jõuab siia runGuarded/saveRef kaudu.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { WorkPageInfo } from '../../../services/workApi';
import {
  changePartPages, createPart, deletePart, listParts, updatePart, type WorkPart,
} from '../../../services/workPartsApi';
import { draftFromPart, emptyDraft, pageBadges, partFromDraft, sharedStems, sortParts, type PartDraft } from '../partsModel';
import PartsGrid from './PartsGrid';
import PartsList from './PartsList';
import PartForm from './PartForm';

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
  const { t } = useTranslation(['workspace']);
  const [parts, setParts] = useState<WorkPart[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [anchor, setAnchor] = useState<string | null>(null);
  const [editing, setEditing] = useState<Editing>(null);
  const [draft, setDraft] = useState<PartDraft>(emptyDraft());
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const stems = useMemo(() => pages.map(p => p.base_name), [pages]);
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
    setDirty(true);
    setError(null);
  });

  const fail = (e: unknown) => setError((e as Error).message || String(e));

  const save = useCallback(async (): Promise<boolean> => {
    if (!editing) return true;
    setBusy(true);
    setError(null);
    try {
      const input = partFromDraft(draft, editing.id ? (active?.pages ?? editing.pages) : editing.pages);
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
  }, [editing, draft, active, workId, token, reload]);

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

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_22rem]">
      <div className="space-y-3">
        {selected.size > 0 && (
          <div className="flex flex-wrap items-center gap-2 rounded border border-primary-200 bg-primary-50 px-3 py-2 text-sm">
            <span className="text-primary-800">{t('manage.parts.selected', { count: selected.size })}</span>
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
          </div>
        )}
        <PartsGrid
          workId={workId}
          pages={pages}
          badges={badges}
          selected={selected}
          activeStems={activeStems}
          imageToken={imageToken}
          thumbCacheBust={thumbCacheBust}
          onToggle={toggle}
        />
      </div>
      <div className="space-y-4">
        <PartsList parts={sorted} activeId={editing?.id ?? null} onSelect={openPart} />
        {editing && (
          <PartForm
            isNew={!editing.id}
            draft={draft}
            onDraft={editDraft}
            otherParts={parts.filter(p => p.id !== editing.id && p.kind !== 'attachment')}
            sharedStems={shared}
            error={error}
            busy={busy}
            token={token}
            onSave={() => { void save(); }}
            onDelete={() => { void remove(); }}
          />
        )}
        {!editing && error && <p className="text-sm text-red-600">{t('manage.parts.error', { message: error })}</p>}
      </div>
    </div>
  );
};

export default PartsTab;
