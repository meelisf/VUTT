/**
 * Eksemplari lehe kaart „Eksemplarid": loend, valitud rea kirje täisvaade ja
 * toimetamine (ADR 0076 p 5; spets 2026-11-10 „Kaart Eksemplarid").
 *
 * Vorm ja kirjutused on tõstetud metaandmete modaali endisest eksemplaride sektsioonist:
 * samad väljad, sama valideerimine (`exemplarDraft.ts`), samad otspunktid.
 * Uut kirjutusteed ei ole. Pärast iga kirjutust laeb leht andmed serverist
 * uuesti (`onChanged`) — klient ei arvuta ise, kellelt aluse märge kadus.
 *
 * Korraga on lahti ÜKS mustand. Selle salvestamata olek läheb `onDirtyChange`
 * kaudu lehele, mis kaitseb lahkumist `useUnsavedChangesGuard`-iga.
 *
 * Avalik lugeja (mitte-admin) ei näe toiminguid, järjestusnooli, märki „vajab
 * ülevaatust" ega tehnilist allikat (migration/manual/upload).
 */
import React, { useEffect, useImperativeHandle, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowDown, ArrowUp, Pencil, Plus, Trash2 } from 'lucide-react';
import { REPRODUCTION_KINDS } from '../../types';
import type { Exemplar } from '../../types';
import {
  createWorkExemplar, deleteWorkExemplar, reorderWorkExemplars, updateWorkExemplar,
  type WorkExemplarsResponse,
} from '../../services/workApi';
import { ApiError, apiErrorMessage } from '../../services/apiClient';
import { useConfirm, useNotify } from '../../contexts/FeedbackContext';
import { isAtLeast } from '../../utils/roleUtils';
import ArchiveSelect from '../ArchiveSelect';
import SameVolumeBlock from '../convolutes/SameVolumeBlock';
import { exceptionPages, orderExemplars } from './exemplarCardUtils';
import { MORE_FIELDS, bodyFromDraft, convoluteFromDraft, sameDraft, toDraft, type Draft } from './exemplarDraft';
import { PAGES_KEY, externalLinkLabel, hasWitness, isCitationSource, ownerCounts } from './exemplarSequences';

interface ArchiveInfo { name: string; url?: string }

export interface ExemplarListHandle {
  /** Salvestab lahtise mustandi. `true` = salvestatud või polnud midagi salvestada. */
  saveDraft: () => Promise<boolean>;
}

interface ExemplarListProps {
  workId: string;
  authToken: string | null;
  userRole?: string;
  /** Käsikiri (`type.id === 'Q87167'`) = üks eksemplar (ADR 0076 p 2). */
  isManuscript: boolean;
  /** Lehe laetud `GET /works/{id}/exemplars` vastus. */
  data: WorkExemplarsResponse;
  archives: Record<string, ArchiveInfo>;
  onArchiveAdded: (id: string, info: ArchiveInfo) => void;
  /** Eksemplari id | PAGES_KEY | null. */
  selected: string | null;
  onSelect: (key: string) => void;
  /** Leht laeb `data` uuesti. */
  onChanged: () => Promise<void>;
  onDirtyChange?: (dirty: boolean) => void;
  ref?: React.Ref<ExemplarListHandle>;
}

interface Editing { id: string | null; draft: Draft; original: Draft }  // id null = uus kirje

const inputClass = 'w-full border border-gray-300 rounded px-2 py-1.5 text-sm focus:ring-2 focus:ring-primary-500 outline-none bg-white';
const labelClass = 'block text-xs font-medium text-gray-500 mb-1';
const iconButton = 'p-1 rounded text-gray-500 hover:text-gray-800 hover:bg-gray-100 disabled:opacity-30 disabled:hover:bg-transparent';
const actionLink = 'text-xs text-gray-600 hover:text-gray-900 underline-offset-2 hover:underline disabled:opacity-50';
const isHttpUrl = (url?: string) => !!url && /^https?:\/\//.test(url);

const ExemplarList: React.FC<ExemplarListProps> = ({
  workId, authToken, userRole, isManuscript, data, archives, onArchiveAdded,
  selected, onSelect, onChanged, onDirtyChange, ref,
}) => {
  const { t, i18n } = useTranslation(['workspace', 'common']);
  const notify = useNotify();
  const askConfirm = useConfirm();
  const canEdit = isAtLeast(userRole, 'admin') && !!authToken;

  const [editing, setEditing] = useState<Editing | null>(null);
  const [busy, setBusy] = useState(false);
  const [pickWitness, setPickWitness] = useState(false);

  const dirty = editing !== null && !sameDraft(editing.draft, editing.original);
  useEffect(() => { onDirtyChange?.(dirty); }, [dirty, onDirtyChange]);
  useEffect(() => () => onDirtyChange?.(false), [onDirtyChange]);

  const saved = data.exemplars;
  const list = orderExemplars(saved);
  const imageCount = (id: string) => data.images?.[id]?.count ?? 0;
  // Arvud tulevad samast omaniku-lahendusest mis pildimaterjali jaotis (exemplarSequences).
  const counts = ownerCounts(data);
  const unknownCount = counts.get('unknown') ?? 0;
  const unassignedCount = (counts.get(null) ?? 0) + unknownCount;
  const witnessed = hasWitness(data);

  /** Üks kirjutus: viga → teade serveri põhjendusega; alati loend serverist uuesti.
   *  404 (eksemplar kustutati teises aknas) sulgeb mustandi — muud vead jätavad
   *  selle lahti, et kasutaja ei kaotaks sisestatut. */
  const write = async (op: () => Promise<unknown>): Promise<boolean> => {
    if (!authToken) return false;
    setBusy(true);
    try {
      await op();
      await onChanged();
      return true;
    } catch (e) {
      notify(apiErrorMessage(e, t('exemplars.saveError')), 'error');
      if (e instanceof ApiError && e.status === 404) setEditing(null);
      await onChanged();
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
    const convolute = convoluteFromDraft(d);
    if (convolute === 'invalid') {
      notify(t('exemplars.convolute.countInvalid'), 'warning');
      return false;
    }
    if (convolute === 'noReference') {
      notify(t('exemplars.convolute.referenceRequired'), 'warning');
      return false;
    }
    const body = bodyFromDraft(d, convolute);
    const ok = await write(() => editing.id === null
      ? createWorkExemplar(workId, body, authToken!)
      : updateWorkExemplar(workId, editing.id, body, authToken!));
    if (ok) setEditing(null);
    return ok;
  };

  useImperativeHandle(ref, () => ({ saveDraft }));

  const startEdit = (x?: Exemplar) => {
    const d = toDraft(x);
    setEditing({ id: x?.id ?? null, draft: d, original: d });
    if (x) onSelect(x.id);
  };

  const setField = (f: keyof Draft, v: string) =>
    setEditing(prev => (prev ? { ...prev, draft: { ...prev.draft, [f]: v } } : prev));

  const toggleWitness = async (x: Exemplar) => {
    if (!x.text_witness) {
      const other = saved.find(e => e.text_witness && e.id !== x.id);
      if (other || x.pages?.length) {
        const ok = await askConfirm({
          title: t('exemplars.witnessConfirmTitle'),
          message: t('exemplars.witnessConfirm'),
          variant: 'warning',
        });
        if (!ok) return;
      }
    }
    await write(() => updateWorkExemplar(workId, x.id, { text_witness: !x.text_witness }, authToken!));
  };

  const clearReview = (x: Exemplar) =>
    write(() => updateWorkExemplar(workId, x.id, { needs_review: false }, authToken!));

  const remove = async (x: Exemplar) => {
    const label = [x.holder, x.shelfmark].filter(Boolean).join(' ');
    const ok = await askConfirm({
      title: t('exemplars.deleteTitle'),
      message: imageCount(x.id)
        ? t('exemplars.deleteConfirmImages', { label, count: imageCount(x.id) })
        : t('exemplars.deleteConfirm', { label }),
      confirmText: t('exemplars.delete'),
      variant: 'danger',
    });
    if (ok) await write(() => deleteWorkExemplar(workId, x.id, authToken!));
  };

  /** Järjestus kuvatud naabriga: vahetatakse kahe kirje koht salvestatud järjekorras. */
  const move = (x: Exemplar, delta: -1 | 1) => {
    const shown = list.findIndex(e => e.id === x.id);
    const other = list[shown + delta];
    if (!other || other.text_witness || x.text_witness) return;
    const ids = saved.map(e => e.id);
    const a = ids.indexOf(x.id);
    const b = ids.indexOf(other.id);
    [ids[a], ids[b]] = [ids[b], ids[a]];
    void write(() => reorderWorkExemplars(workId, ids, authToken!));
  };

  const exemplarLabel = (id: string) => {
    const o = saved.find(e => e.id === id);
    return o ? [o.holder, o.shelfmark].filter(Boolean).join(', ') : t('exemplars.reproduction.missing');
  };

  const sourceText = (x: Exemplar) => {
    if (!x.source) return '';
    const kind = t(`exemplars.sourceKind.${x.source.kind}`, x.source.kind);
    const ref = x.source.ref ?? '';
    return ref && ref.toLowerCase().startsWith(x.source.kind) ? ref : [kind, ref].filter(Boolean).join(' ');
  };

  /** Materjali arv kinnisel real: oma teose lehed ja oma pildid. */
  const materialCount = (x: Exemplar) => {
    const pages = counts.get(x.id) ?? 0;
    const out: string[] = [];
    if (pages) out.push(t('exemplarPage.pageCount', { count: pages }));
    if (imageCount(x.id)) out.push(t('exemplarImages.count', { count: imageCount(x.id) }));
    return out.join(' · ');
  };

  const editorOpen = editing !== null;
  const manuscriptFull = isManuscript && saved.length >= 1;

  const renderEditor = () => {
    if (!editing) return null;
    const d = editing.draft;
    return (
      <div className="space-y-3 pt-1" data-testid="exemplar-editor">
        <div>
          <label className={labelClass}>{t('exemplars.holder')}</label>
          <ArchiveSelect archives={archives} value={d.holder} onChange={v => setField('holder', v)}
            onArchiveAdded={onArchiveAdded} userRole={userRole || 'contributor'} authToken={authToken ?? ''} />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <div>
            <label className={labelClass} htmlFor="exemplar-shelfmark">{t('exemplars.shelfmark')}</label>
            <input id="exemplar-shelfmark" className={inputClass} value={d.shelfmark}
              onChange={e => setField('shelfmark', e.target.value)} placeholder={t('exemplars.shelfmarkPlaceholder')} />
          </div>
          <div>
            <label className={labelClass} htmlFor="exemplar-url">{t('exemplars.url')}</label>
            <input id="exemplar-url" className={inputClass} value={d.url}
              onChange={e => setField('url', e.target.value)} placeholder="https://..." />
          </div>
          <div>
            <label className={labelClass} htmlFor="exemplar-rep-kind">{t('exemplars.reproduction.kind')}</label>
            <select id="exemplar-rep-kind" className={inputClass} value={d.repKind}
              onChange={e => { setField('repKind', e.target.value); if (!e.target.value) setField('repOf', ''); }}>
              <option value="">{t('exemplars.reproduction.original')}</option>
              {REPRODUCTION_KINDS.map(k => <option key={k} value={k}>{t(`exemplars.reproduction.kinds.${k}`)}</option>)}
            </select>
          </div>
          <div>
            <label className={labelClass} htmlFor="exemplar-rep-of">{t('exemplars.reproduction.of')}</label>
            <select id="exemplar-rep-of" className={inputClass} value={d.repOf} disabled={!d.repKind}
              onChange={e => setField('repOf', e.target.value)}>
              <option value="">{t('exemplars.reproduction.unknown')}</option>
              {saved.filter(e => e.id !== editing.id).map(e => (
                <option key={e.id} value={e.id}>{exemplarLabel(e.id)}</option>
              ))}
            </select>
          </div>
        </div>

        <p className="text-[11px] uppercase tracking-wider text-gray-400">{t('exemplars.convolute.label')}</p>
        <div className="space-y-2" data-testid="convolute-fields">
          <p className="text-[11px] text-gray-500">{t('exemplars.convolute.hint')}</p>
          <div className="grid grid-cols-3 gap-2">
            <div className="col-span-3 sm:col-span-1">
              <label className={labelClass} htmlFor="convolute-reference">{t('exemplars.convolute.reference')}</label>
              <input id="convolute-reference" className={inputClass} value={d.convReference}
                onChange={e => setField('convReference', e.target.value)} placeholder="R Est.B-954" />
            </div>
            <div>
              <label className={labelClass} htmlFor="convolute-position">{t('exemplars.convolute.position')}</label>
              <input id="convolute-position" type="text" inputMode="numeric" className={inputClass} value={d.convPosition}
                onChange={e => setField('convPosition', e.target.value)} placeholder="0" />
            </div>
            <div>
              <label className={labelClass} htmlFor="convolute-total">{t('exemplars.convolute.total')}</label>
              <input id="convolute-total" type="text" inputMode="numeric" className={inputClass} value={d.convTotal}
                onChange={e => setField('convTotal', e.target.value)} />
            </div>
          </div>
          <div>
            <label className={labelClass} htmlFor="convolute-contents">{t('exemplars.convolute.contents')}</label>
            <textarea id="convolute-contents" rows={2} className={`${inputClass} resize-y`} value={d.convContents}
              onChange={e => setField('convContents', e.target.value)} />
            <p className="text-[11px] text-gray-500 mt-0.5">{t('exemplars.convolute.contentsHint')}</p>
          </div>
        </div>

        <p className="text-[11px] uppercase tracking-wider text-gray-400">{t('exemplarPage.physical')}</p>
        <div className="space-y-2">
          {MORE_FIELDS.map(f => (
            <div key={f}>
              <label className={labelClass} htmlFor={`exemplar-${f}`}>{t(`exemplars.fields.${f}`)}</label>
              <textarea id={`exemplar-${f}`} rows={f === 'notes' ? 2 : 1} className={`${inputClass} resize-y`}
                value={d[f]} onChange={e => setField(f, e.target.value)} />
            </div>
          ))}
        </div>
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

  /** Lahtise rea kirje: ainult täidetud väljad. */
  const renderDetail = (x: Exemplar) => {
    const rows: [string, React.ReactNode][] = [];
    if (archives[x.holder]?.name) rows.push([t('exemplars.holder'), archives[x.holder].name]);
    if (x.reproduction) {
      rows.push([t('exemplars.reproduction.label'), `${t(`exemplars.reproduction.kinds.${x.reproduction.kind}`)} · ${
        x.reproduction.of ? exemplarLabel(x.reproduction.of) : t('exemplars.reproduction.unknown')}`]);
    }
    const pages = exceptionPages(x, data.page_numbers);
    if (pages) rows.push([t('exemplarPage.exceptionPages'), pages]);
    for (const f of ['condition', 'binding', 'provenance'] as const) {
      if (x[f]) rows.push([t(`exemplars.fields.${f}`), x[f]]);
    }
    if (x.convolute) {
      const blocks = data.convolutes.filter(b => b.exemplar_id === x.id);
      rows.push([t('exemplars.convolute.label'), (
        <div data-testid="convolute-summary">
          <span>{[
            x.convolute.reference,
            x.convolute.position != null && (x.convolute.position === 0
              ? t('common:convolute.main')
              : t('common:convolute.position', { n: x.convolute.position })),
            x.convolute.total != null && t('common:convolute.total', { count: x.convolute.total }),
          ].filter(Boolean).join(' · ')}</span>
          <SameVolumeBlock blocks={blocks} lang={i18n.language} />
          {x.convolute.contents && (
            <p className="mt-1 pl-2 border-l-2 border-gray-200 text-gray-600 whitespace-pre-line">
              <span className="text-gray-400">{t('exemplars.convolute.contents')}:</span> {x.convolute.contents}
            </p>
          )}
        </div>
      )]);
    }
    if (x.notes) rows.push([t('exemplars.fields.notes'), <span className="whitespace-pre-line">{x.notes}</span>]);
    if (x.source && (canEdit || isCitationSource(x.source.kind))) {
      rows.push([t('exemplars.source'), [sourceText(x), canEdit ? x.source.at : undefined].filter(Boolean).join(' · ')]);
    }
    return (
      <div className="pt-2 pl-1" data-testid="exemplar-detail">
        {rows.length > 0 && (
          <dl className="grid grid-cols-[7rem_1fr] gap-x-3 gap-y-1.5 text-sm">
            {rows.map(([k, v], i) => (
              <React.Fragment key={i}>
                <dt className="text-gray-500">{k}</dt>
                <dd className="text-gray-800 min-w-0 break-words">{v}</dd>
              </React.Fragment>
            ))}
          </dl>
        )}
        {canEdit && (
          <div className="flex flex-wrap gap-4 mt-3">
            <button type="button" onClick={() => startEdit(x)} disabled={busy || editorOpen}
              className={`${actionLink} inline-flex items-center gap-1`}>
              <Pencil size={12} />{t('exemplars.edit')}
            </button>
            <button type="button" onClick={() => void toggleWitness(x)} disabled={busy || editorOpen} className={actionLink}>
              {x.text_witness ? t('exemplars.unmarkWitness') : t('exemplars.markWitness')}
            </button>
            {x.needs_review && (
              <button type="button" onClick={() => void clearReview(x)} disabled={busy || editorOpen}
                className="text-xs text-amber-700 hover:text-amber-900 underline-offset-2 hover:underline disabled:opacity-50">
                {t('exemplars.markReviewed')}
              </button>
            )}
            <button type="button" onClick={() => void remove(x)} disabled={busy || editorOpen}
              className="text-xs text-red-700 hover:text-red-900 underline-offset-2 hover:underline disabled:opacity-50 inline-flex items-center gap-1">
              <Trash2 size={12} />{t('exemplars.delete')}
            </button>
          </div>
        )}
      </div>
    );
  };

  const rowBase = 'px-4 sm:px-5 py-2.5 border-t border-gray-100 first:border-t-0';

  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm" data-testid="exemplar-list">
      <div className="flex flex-wrap items-center gap-2 px-4 sm:px-5 py-3 border-b border-gray-100">
        <h2 className="text-sm font-semibold text-gray-800">{t('exemplars.title')}</h2>
        <span className="text-[11px] bg-gray-100 text-gray-500 px-2 rounded-full">{saved.length}</span>
        {canEdit && !editorOpen && (
          manuscriptFull ? (
            <p className="ml-auto text-xs text-gray-500 basis-full sm:basis-auto" data-testid="manuscript-hint">
              {t('exemplars.manuscriptOne')}
            </p>
          ) : (
            <button type="button" onClick={() => startEdit()} disabled={busy}
              className="ml-auto text-xs font-medium text-primary-700 hover:text-primary-900 flex items-center gap-1 disabled:opacity-50">
              <Plus size={12} />{t('exemplars.add')}
            </button>
          )
        )}
      </div>

      {saved.length === 0 && editing?.id !== null && (
        <p className="px-4 sm:px-5 py-3 text-sm text-gray-500">{t('exemplarPage.none')}</p>
      )}

      <ul>
        {list.map((x, idx) => {
          const open = selected === x.id;
          const ext = isHttpUrl(x.url) ? x.url : undefined;
          return (
            <li key={x.id} className={`${rowBase} ${editing?.id === x.id ? 'bg-amber-50/60 shadow-[inset_3px_0_0_#f59e0b]'
              : open ? 'bg-slate-50 shadow-[inset_3px_0_0_#2563eb]' : ''}`}>
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
                <button type="button" onClick={() => onSelect(x.id)} aria-expanded={open}
                  className="flex flex-wrap items-baseline gap-x-2 text-left min-w-0 hover:text-primary-800">
                  <span className="font-semibold text-gray-900">{x.holder}</span>
                  {x.shelfmark
                    ? <span className="text-gray-700">{x.shelfmark}</span>
                    : archives[x.holder]?.name && <span className="text-gray-400">{archives[x.holder].name}</span>}
                </button>
                {x.text_witness && (
                  <span className="text-[11px] leading-4 px-1.5 rounded-full border border-primary-300 text-primary-800 whitespace-nowrap">
                    {t('exemplars.witness')}
                  </span>
                )}
                {canEdit && x.needs_review && (
                  <span className="text-[11px] leading-4 px-1.5 rounded-full border border-amber-300 bg-amber-50 text-amber-800 whitespace-nowrap"
                    title={t('exemplars.needsReviewHint')}>
                    {t('exemplars.needsReview')}
                  </span>
                )}
                {ext && (
                  <a href={ext} target="_blank" rel="noopener noreferrer" title={ext}
                    className="text-[11px] leading-4 px-1.5 rounded-full border border-gray-300 text-primary-700 hover:text-primary-900 whitespace-nowrap">
                    {externalLinkLabel(ext)} ↗
                  </a>
                )}
                <span className="ml-auto flex items-center gap-2 text-xs text-gray-500">
                  {x.source && isCitationSource(x.source.kind) && !open && <span>{sourceText(x)}</span>}
                  {materialCount(x) && <span>{materialCount(x)}</span>}
                  {canEdit && (
                    <>
                      <button type="button" className={iconButton} onClick={() => move(x, -1)}
                        disabled={busy || editorOpen || x.text_witness || idx === 0 || !!list[idx - 1]?.text_witness}
                        title={t('exemplars.moveUp')} aria-label={t('exemplars.moveUp')}>
                        <ArrowUp size={14} />
                      </button>
                      <button type="button" className={iconButton} onClick={() => move(x, 1)}
                        disabled={busy || editorOpen || x.text_witness || idx === list.length - 1}
                        title={t('exemplars.moveDown')} aria-label={t('exemplars.moveDown')}>
                        <ArrowDown size={14} />
                      </button>
                    </>
                  )}
                </span>
              </div>
              {editing?.id === x.id ? renderEditor() : open && renderDetail(x)}
            </li>
          );
        })}

        {editing?.id === null && (
          <li className={`${rowBase} bg-amber-50/60 shadow-[inset_3px_0_0_#f59e0b]`}>{renderEditor()}</li>
        )}

        {!witnessed && data.page_count > 0 && (
          <li data-testid="pages-row"
            className={`${rowBase} bg-amber-50 ${selected === PAGES_KEY ? 'shadow-[inset_3px_0_0_#2563eb]' : ''}`}>
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
              <button type="button" onClick={() => onSelect(PAGES_KEY)} aria-expanded={selected === PAGES_KEY}
                className="flex flex-wrap items-baseline gap-x-2 text-left hover:text-primary-800">
                <span className="font-semibold text-amber-900">{t('exemplarPage.pagesRow')}</span>
                <span className="text-amber-900">· {unassignedCount}</span>
                <span className="text-xs text-amber-800">— {t('exemplarPage.pagesRowHint')}</span>
              </button>
              {canEdit && saved.length > 0 && (
                pickWitness ? (
                  <select aria-label={t('exemplarPage.markWitness')} defaultValue="" autoFocus
                    disabled={busy} className="ml-auto text-xs border border-gray-300 rounded px-1.5 py-1 bg-white"
                    onBlur={() => setPickWitness(false)}
                    onChange={e => {
                      const x = saved.find(s => s.id === e.target.value);
                      setPickWitness(false);
                      if (x) void toggleWitness(x);
                    }}>
                    <option value="" disabled>{t('exemplarPage.markWitness')}</option>
                    {list.map(x => <option key={x.id} value={x.id}>{exemplarLabel(x.id)}</option>)}
                  </select>
                ) : (
                  <button type="button" onClick={() => setPickWitness(true)} disabled={busy || editorOpen}
                    className="ml-auto text-xs px-2 py-1 rounded border border-amber-300 bg-white text-amber-900 hover:bg-amber-100 disabled:opacity-50">
                    {t('exemplarPage.markWitness')}
                  </button>
                )
              )}
            </div>
          </li>
        )}

        {unknownCount > 0 && (
          <li className={`${rowBase} text-sm text-gray-600`} data-testid="unknown-pages-row">
            {t('exemplarPage.unknownPagesRow')} · {unknownCount}
          </li>
        )}
      </ul>
    </div>
  );
};

export default ExemplarList;
