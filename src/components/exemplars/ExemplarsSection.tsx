/**
 * Eksemplaride sektsioon MetadataModal-is (ADR 0076 p 5, #713).
 *
 * Eksemplarid muutuvad AINULT oma otspunktidega (`/works/{id}/exemplars`) ja
 * iga muudatus salvestub kohe — modaali üldine „Salvesta" neid ei puuduta
 * (`buildMetadataPayload` ei saada `exemplars`/`archive_refs`, server vastaks 400).
 *
 * Tekstitunnistaja ja `needs_review` reeglid jõustab server. Pärast iga
 * kirjutust laetakse loend serverist uuesti — klient ei arvuta ise, kellelt
 * tunnistaja märge kadus.
 *
 * Korraga on lahti ÜKS mustand (muudetav või uus kirje). Selle salvestamata
 * olek antakse `onDirtyChange` kaudu modaalile, mis kaitseb sulgemist
 * `UnsavedChangesDialog`-iga; `saveDraft` on modaalile ref'i kaudu kättesaadav
 * („Salvesta ja jätka").
 */
import React, { useCallback, useEffect, useImperativeHandle, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowDown, ArrowUp, ChevronDown, ExternalLink, Pencil, Plus, Trash2 } from 'lucide-react';
import type { Exemplar } from '../../types';
import {
  createWorkExemplar, deleteWorkExemplar, getWorkExemplars, reorderWorkExemplars, updateWorkExemplar,
  type ExemplarInput,
} from '../../services/workApi';
import { apiErrorMessage } from '../../services/apiClient';
import { useConfirm, useNotify } from '../../contexts/FeedbackContext';
import { isAtLeast } from '../../utils/roleUtils';
import ArchiveSelect from '../ArchiveSelect';

interface ArchiveInfo { name: string; url?: string }

export interface ExemplarsSectionHandle {
  /** Salvestab lahtise mustandi. `true` = salvestatud või polnud midagi salvestada. */
  saveDraft: () => Promise<boolean>;
}

interface ExemplarsSectionProps {
  workId: string;
  authToken: string;
  userRole?: string;
  /** Käsikiri (`type.id === 'Q87167'`) = üks eksemplar (ADR 0076 p 2). */
  isManuscript: boolean;
  archives: Record<string, ArchiveInfo>;
  onArchiveAdded: (id: string, info: ArchiveInfo) => void;
  onDirtyChange?: (dirty: boolean) => void;
  /** Kutsutakse pärast iga edukat kirjutust (nt tuletatud arhiiviviidete värskendus). */
  onChanged?: () => void;
  ref?: React.Ref<ExemplarsSectionHandle>;
}

const TEXT_FIELDS = ['holder', 'shelfmark', 'url', 'condition', 'binding', 'provenance', 'notes'] as const;
const MORE_FIELDS = ['condition', 'binding', 'provenance', 'notes'] as const;
type Draft = Record<(typeof TEXT_FIELDS)[number], string>;

const toDraft = (x?: Exemplar): Draft => ({
  holder: x?.holder ?? '',
  shelfmark: x?.shelfmark ?? '',
  url: x?.url ?? '',
  condition: x?.condition ?? '',
  binding: x?.binding ?? '',
  provenance: x?.provenance ?? '',
  notes: x?.notes ?? '',
});

const sameDraft = (a: Draft, b: Draft) => TEXT_FIELDS.every(f => a[f].trim() === b[f].trim());

interface Editing { id: string | null; draft: Draft; original: Draft }  // id null = uus kirje

const inputClass = 'w-full border border-gray-300 rounded px-2 py-1.5 text-sm focus:ring-2 focus:ring-primary-500 outline-none bg-white';
const iconButton = 'p-1 rounded text-gray-500 hover:text-gray-800 hover:bg-gray-100 disabled:opacity-30 disabled:hover:bg-transparent';

const ExemplarsSection: React.FC<ExemplarsSectionProps> = ({
  workId, authToken, userRole, isManuscript, archives, onArchiveAdded, onDirtyChange, onChanged, ref,
}) => {
  const { t } = useTranslation(['workspace', 'common']);
  const notify = useNotify();
  const askConfirm = useConfirm();
  const canEdit = isAtLeast(userRole, 'admin');

  const [exemplars, setExemplars] = useState<Exemplar[] | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [editing, setEditing] = useState<Editing | null>(null);
  const [moreOpen, setMoreOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const dirty = editing !== null && !sameDraft(editing.draft, editing.original);
  useEffect(() => { onDirtyChange?.(dirty); }, [dirty, onDirtyChange]);
  // Lahtimonteerimisel (modaal suleti) ei jää vana lipp modaali külge.
  useEffect(() => () => onDirtyChange?.(false), [onDirtyChange]);

  const reload = useCallback(async () => {
    try {
      const res = await getWorkExemplars(workId, authToken);
      setExemplars(res.exemplars || []);
      setLoadFailed(false);
    } catch {
      setLoadFailed(true);
    }
  }, [workId, authToken]);

  useEffect(() => { void reload(); }, [reload]);

  /** Üks kirjutus: viga → teade serveri põhjendusega; edu → loend serverist uuesti. */
  const write = async (op: () => Promise<unknown>): Promise<boolean> => {
    setBusy(true);
    try {
      await op();
      await reload();
      onChanged?.();
      return true;
    } catch (e) {
      notify(apiErrorMessage(e, t('exemplars.saveError')), 'error');
      // Server võis vahepeal muutuda (nt teine toimetaja) — näita tegelikku seisu.
      await reload();
      return false;
    } finally {
      setBusy(false);
    }
  };

  const saveDraft = async (): Promise<boolean> => {
    if (!editing || !dirty) { setEditing(null); return true; }
    const d = editing.draft;
    if (!d.holder.trim()) {
      notify(t('exemplars.holderRequired'), 'warning');
      return false;
    }
    // Kõik väljad kaasa: tühi string eemaldab serveris välja (väärtuseta = võtme puudumine).
    const body: ExemplarInput = Object.fromEntries(TEXT_FIELDS.map(f => [f, d[f].trim()]));
    const ok = await write(() => editing.id === null
      ? createWorkExemplar(workId, body, authToken)
      : updateWorkExemplar(workId, editing.id, body, authToken));
    if (ok) setEditing(null);
    return ok;
  };

  useImperativeHandle(ref, () => ({ saveDraft }));

  const startEdit = (x?: Exemplar) => {
    const d = toDraft(x);
    setEditing({ id: x?.id ?? null, draft: d, original: d });
    setMoreOpen(MORE_FIELDS.some(f => d[f]));
  };

  const setField = (f: keyof Draft, v: string) =>
    setEditing(prev => (prev ? { ...prev, draft: { ...prev.draft, [f]: v } } : prev));

  const toggleWitness = async (x: Exemplar) => {
    if (!x.text_witness) {
      const other = exemplars?.find(e => e.text_witness && e.id !== x.id);
      if (other || x.pages?.length) {
        const ok = await askConfirm({
          title: t('exemplars.witnessConfirmTitle'),
          message: t('exemplars.witnessConfirm'),
          variant: 'warning',
        });
        if (!ok) return;
      }
    }
    await write(() => updateWorkExemplar(workId, x.id, { text_witness: !x.text_witness }, authToken));
  };

  const clearReview = (x: Exemplar) =>
    write(() => updateWorkExemplar(workId, x.id, { needs_review: false }, authToken));

  const remove = async (x: Exemplar) => {
    const ok = await askConfirm({
      title: t('exemplars.deleteTitle'),
      message: t('exemplars.deleteConfirm', { label: [x.holder, x.shelfmark].filter(Boolean).join(' ') }),
      confirmText: t('exemplars.delete'),
      variant: 'danger',
    });
    if (ok) await write(() => deleteWorkExemplar(workId, x.id, authToken));
  };

  const move = (idx: number, delta: -1 | 1) => {
    if (!exemplars) return;
    const ids = exemplars.map(e => e.id);
    const j = idx + delta;
    if (j < 0 || j >= ids.length) return;
    [ids[idx], ids[j]] = [ids[j], ids[idx]];
    void write(() => reorderWorkExemplars(workId, ids, authToken));
  };

  const list = exemplars ?? [];
  // Mitteadminile ilma eksemplarideta sektsiooni ei näidata (nagu varem arhiiviviiteid).
  if (!canEdit && list.length === 0) return null;

  const manuscriptFull = isManuscript && list.length >= 1;
  const editorOpen = editing !== null;

  const holderLabel = (id: string) => archives[id]?.name ? `${id} — ${archives[id].name}` : id;

  const renderEditor = () => {
    if (!editing) return null;
    const d = editing.draft;
    return (
      <div className="space-y-2 border border-amber-300 bg-amber-50/40 rounded p-2" data-testid="exemplar-editor">
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">{t('exemplars.holder')}</label>
          <ArchiveSelect
            archives={archives}
            value={d.holder}
            onChange={v => setField('holder', v)}
            onArchiveAdded={onArchiveAdded}
            userRole={userRole || 'contributor'}
            authToken={authToken}
          />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1" htmlFor="exemplar-shelfmark">{t('exemplars.shelfmark')}</label>
            <input id="exemplar-shelfmark" className={inputClass} value={d.shelfmark}
              onChange={e => setField('shelfmark', e.target.value)} placeholder={t('exemplars.shelfmarkPlaceholder')} />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1" htmlFor="exemplar-url">{t('exemplars.url')}</label>
            <input id="exemplar-url" className={inputClass} value={d.url}
              onChange={e => setField('url', e.target.value)} placeholder="https://..." />
          </div>
        </div>
        <button type="button" onClick={() => setMoreOpen(v => !v)}
          className="text-xs text-gray-600 hover:text-gray-900 flex items-center gap-1">
          <ChevronDown size={12} className={moreOpen ? 'rotate-180' : ''} />
          {t('exemplars.more')}
        </button>
        {moreOpen && (
          <div className="space-y-2">
            {MORE_FIELDS.map(f => (
              <div key={f}>
                <label className="block text-xs font-medium text-gray-500 mb-1" htmlFor={`exemplar-${f}`}>{t(`exemplars.fields.${f}`)}</label>
                <textarea id={`exemplar-${f}`} rows={f === 'notes' ? 2 : 1} className={`${inputClass} resize-y`}
                  value={d[f]} onChange={e => setField(f, e.target.value)} />
              </div>
            ))}
          </div>
        )}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={() => setEditing(null)} disabled={busy}
            className="px-3 py-1 text-xs font-medium text-gray-600 hover:text-gray-800">
            {t('common:buttons.cancel')}
          </button>
          <button type="button" onClick={() => void saveDraft()} disabled={busy || !dirty}
            className="px-3 py-1 rounded text-xs font-medium bg-amber-600 text-white hover:bg-amber-700 disabled:opacity-50">
            {t('exemplars.saveExemplar')}
          </button>
        </div>
      </div>
    );
  };

  return (
    <div className="border border-gray-200 rounded-lg p-3 space-y-2 bg-gray-50/50" data-testid="exemplars-section">
      <h4 className="text-xs font-bold text-gray-600 uppercase -mt-1">{t('exemplars.title')}</h4>
      {canEdit && <p className="text-xs text-gray-500">{t('exemplars.savesImmediately')}</p>}
      {loadFailed && <p className="text-xs text-red-600">{t('exemplars.loadError')}</p>}

      {list.length === 0 && !loadFailed && exemplars !== null && !editorOpen && (
        <p className="text-sm text-gray-500">{t('exemplars.none')}</p>
      )}

      <ul className="space-y-2">
        {list.map((x, idx) => (
          <li key={x.id} className="text-sm text-gray-700 bg-white border border-gray-200 rounded p-2">
            {editing?.id === x.id ? renderEditor() : (
              <div className="flex items-start gap-2">
                <div className="flex-1 min-w-0 space-y-0.5">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span className="font-medium">{holderLabel(x.holder)}</span>
                    {x.shelfmark && <span>· {x.shelfmark}</span>}
                    {x.text_witness && (
                      <span className="text-[11px] px-1.5 py-0.5 rounded bg-green-100 text-green-800">{t('exemplars.witness')}</span>
                    )}
                    {x.needs_review && (
                      <span className="text-[11px] px-1.5 py-0.5 rounded bg-amber-100 text-amber-800" title={t('exemplars.needsReviewHint')}>
                        {t('exemplars.needsReview')}
                      </span>
                    )}
                  </div>
                  {x.url && (
                    <a href={x.url} target="_blank" rel="noopener noreferrer"
                      className="text-xs text-primary-700 hover:underline inline-flex items-center gap-1 break-all">
                      <ExternalLink size={11} />{x.url}
                    </a>
                  )}
                  {MORE_FIELDS.filter(f => x[f]).map(f => (
                    <p key={f} className="text-xs text-gray-600">
                      <span className="text-gray-400">{t(`exemplars.fields.${f}`)}:</span> {x[f]}
                    </p>
                  ))}
                  {canEdit && x.source && (
                    <p className="text-[11px] text-gray-400">
                      {t('exemplars.source')}: {t(`exemplars.sourceKind.${x.source.kind}`, x.source.kind)}
                      {x.source.ref && <> · {x.source.ref}</>}
                      {x.source.at && <> · {x.source.at}</>}
                    </p>
                  )}
                  {canEdit && (
                    <div className="flex flex-wrap gap-3 pt-1 text-xs">
                      <button type="button" onClick={() => void toggleWitness(x)} disabled={busy || editorOpen}
                        className="text-gray-600 hover:text-gray-900 underline-offset-2 hover:underline disabled:opacity-50">
                        {x.text_witness ? t('exemplars.unmarkWitness') : t('exemplars.markWitness')}
                      </button>
                      {x.needs_review && (
                        <button type="button" onClick={() => void clearReview(x)} disabled={busy || editorOpen}
                          className="text-amber-700 hover:text-amber-900 underline-offset-2 hover:underline disabled:opacity-50">
                          {t('exemplars.markReviewed')}
                        </button>
                      )}
                    </div>
                  )}
                </div>
                {canEdit && (
                  <div className="flex items-center gap-0.5 shrink-0">
                    <button type="button" className={iconButton} onClick={() => move(idx, -1)}
                      disabled={busy || editorOpen || idx === 0} title={t('exemplars.moveUp')} aria-label={t('exemplars.moveUp')}>
                      <ArrowUp size={14} />
                    </button>
                    <button type="button" className={iconButton} onClick={() => move(idx, 1)}
                      disabled={busy || editorOpen || idx === list.length - 1} title={t('exemplars.moveDown')} aria-label={t('exemplars.moveDown')}>
                      <ArrowDown size={14} />
                    </button>
                    <button type="button" className={iconButton} onClick={() => startEdit(x)}
                      disabled={busy || editorOpen} title={t('exemplars.edit')} aria-label={t('exemplars.edit')}>
                      <Pencil size={14} />
                    </button>
                    <button type="button" className={`${iconButton} hover:text-red-700`} onClick={() => void remove(x)}
                      disabled={busy || editorOpen} title={t('exemplars.delete')} aria-label={t('exemplars.delete')}>
                      <Trash2 size={14} />
                    </button>
                  </div>
                )}
              </div>
            )}
          </li>
        ))}
      </ul>

      {editing?.id === null && renderEditor()}

      {canEdit && !editorOpen && exemplars !== null && (
        manuscriptFull ? (
          <p className="text-xs text-gray-500" data-testid="manuscript-hint">{t('exemplars.manuscriptOne')}</p>
        ) : (
          <button type="button" onClick={() => startEdit()} disabled={busy}
            className="text-xs font-medium text-primary-700 hover:text-primary-900 flex items-center gap-1 disabled:opacity-50">
            <Plus size={12} />{t('exemplars.add')}
          </button>
        )
      )}
    </div>
  );
};

export default ExemplarsSection;
