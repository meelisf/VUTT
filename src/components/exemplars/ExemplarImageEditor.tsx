import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowDown, ArrowUp, Trash2, Upload } from 'lucide-react';
import { useConfirm, useNotify } from '../../contexts/FeedbackContext';
import { useUnsavedChangesGuard } from '../../hooks/useUnsavedChangesGuard';
import UnsavedChangesDialog from '../UnsavedChangesDialog';
import { apiErrorMessage } from '../../services/apiClient';
import {
  ManifestConflictError, deleteExemplarImage, patchExemplarImages, uploadExemplarImages,
  type ExemplarImage, type ExemplarManifest, type UploadSource,
} from '../../services/exemplarImagesService';

interface ExemplarImageEditorProps {
  workId: string;
  exemplarId: string;
  manifest: ExemplarManifest;
  authToken: string | null;
  onManifest: (m: ExemplarManifest) => void;
}

const UPLOAD_KINDS: UploadSource['kind'][] = ['photo', 'url', 'other'];
const EDIT_KINDS = ['photo', 'url', 'ada', 'other'] as const;

const sameImages = (a: ExemplarImage[], b: ExemplarImage[]) => JSON.stringify(a) === JSON.stringify(b);

/** Mustandi muudatused (silt, leht, allikas) uuele manifestile, ID-de kaupa; järjekord tuleb serverist. */
function reapply(draft: ExemplarImage[], current: ExemplarImage[]): ExemplarImage[] {
  const edited = new Map(draft.map(i => [i.id, i]));
  return current.map(i => {
    const d = edited.get(i.id);
    if (!d) return i;
    const source = i.source.import_id ? { ...i.source, license: d.source.license } : { ...i.source, ...d.source };
    return { ...i, label: d.label, page: d.page, source };
  });
}

/**
 * Eksemplari piltide toimetamine (ADR 0079): üleslaadimine, järjekord, silt,
 * allikas, kustutus. Salvestus kannab revisjoni; 409 → praegune manifest + hoiatus.
 */
const ExemplarImageEditor: React.FC<ExemplarImageEditorProps> = ({
  workId, exemplarId, manifest, authToken, onManifest,
}) => {
  const { t } = useTranslation(['workspace', 'common']);
  const notify = useNotify();
  const askConfirm = useConfirm();
  const [draft, setDraft] = useState<ExemplarImage[]>(manifest.images);
  const [uploadSource, setUploadSource] = useState<UploadSource>({ kind: 'photo' });
  const [busy, setBusy] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const base = useRef(manifest.images);

  // Uus manifest (üleslaadimine, import, teise kasutaja muudatus): mustand jätkub uuel alusel.
  useEffect(() => {
    setDraft(d => (sameImages(d, base.current) ? manifest.images : reapply(d, manifest.images)));
    base.current = manifest.images;
  }, [manifest.images]);

  const isDirty = useMemo(() => !sameImages(draft, manifest.images), [draft, manifest.images]);

  const accept = (m: ExemplarManifest) => {
    if (m.git_committed === false) notify(t('exemplarImages.editor.notCommitted'), 'warning');
    onManifest(m);
  };

  const handleError = (e: unknown) => {
    if (e instanceof ManifestConflictError) {
      notify(t('exemplarImages.editor.conflict'), 'warning');
      onManifest(e.current);
    } else {
      notify(apiErrorMessage(e, t('exemplarImages.editor.error')), 'error');
    }
  };

  const save = async (): Promise<boolean> => {
    setBusy(true);
    try {
      const m = await patchExemplarImages(workId, exemplarId, manifest.revision, draft, authToken);
      base.current = m.images;
      setDraft(m.images);
      accept(m);
      notify(t('exemplarImages.editor.saved'), 'success');
      return true;
    } catch (e) {
      handleError(e);
      return false;
    } finally {
      setBusy(false);
    }
  };

  const { dialogProps } = useUnsavedChangesGuard({ isDirty, onSave: save });

  const upload = async (files: File[]) => {
    if (!files.length) return;
    setBusy(true);
    try {
      const src: UploadSource = { kind: uploadSource.kind };
      if (uploadSource.ref?.trim()) src.ref = uploadSource.ref.trim();
      if (uploadSource.license?.trim()) src.license = uploadSource.license.trim();
      accept(await uploadExemplarImages(workId, exemplarId, files, src, authToken));
    } catch (e) {
      handleError(e);
    } finally {
      setBusy(false);
      if (fileInput.current) fileInput.current.value = '';
    }
  };

  const remove = async (img: ExemplarImage) => {
    const ok = await askConfirm({ message: t('exemplarImages.editor.deleteConfirm'), variant: 'danger' });
    if (!ok) return;
    setBusy(true);
    try {
      accept(await deleteExemplarImage(workId, exemplarId, img.id, manifest.revision, authToken));
    } catch (e) {
      handleError(e);
    } finally {
      setBusy(false);
    }
  };

  const move = (i: number, delta: number) => setDraft(d => {
    const j = i + delta;
    if (j < 0 || j >= d.length) return d;
    const next = [...d];
    [next[i], next[j]] = [next[j], next[i]];
    return next;
  });

  const edit = (i: number, patch: Partial<ExemplarImage>, source?: Partial<ExemplarImage['source']>) =>
    setDraft(d => d.map((img, k) => (k === i
      ? { ...img, ...patch, source: source ? { ...img.source, ...source } : img.source } : img)));

  // Tühi väli = võtme puudumine (server jätab väärtuseta võtme ära).
  const opt = (v: string) => (v === '' ? undefined : v);
  const input = 'border border-gray-300 rounded px-2 py-1 text-sm min-w-0';

  return (
    <div className="mt-4 rounded border border-gray-200 bg-white p-4 space-y-4">
      <div
        className="rounded border-2 border-dashed border-gray-300 p-4 flex flex-wrap items-end gap-3"
        onDragOver={e => e.preventDefault()}
        onDrop={e => { e.preventDefault(); void upload(Array.from(e.dataTransfer.files)); }}
      >
        <label className="text-sm">
          <span className="block text-gray-600">{t('exemplarImages.editor.sourceKind')}</span>
          <select value={uploadSource.kind} disabled={busy} className={input}
            onChange={e => setUploadSource(s => ({ ...s, kind: e.target.value as UploadSource['kind'] }))}>
            {UPLOAD_KINDS.map(k => <option key={k} value={k}>{t(`exemplarImages.editor.kinds.${k}`)}</option>)}
          </select>
        </label>
        <label className="text-sm flex-1 min-w-[12rem]">
          <span className="block text-gray-600">{t('exemplarImages.editor.uploadRef')}</span>
          <input aria-label={t('exemplarImages.editor.uploadRef')} value={uploadSource.ref ?? ''} disabled={busy}
            className={`${input} w-full`} onChange={e => setUploadSource(s => ({ ...s, ref: e.target.value }))} />
        </label>
        <label className="inline-flex items-center gap-2 px-3 py-1.5 rounded bg-primary-600 text-white text-sm cursor-pointer hover:bg-primary-700">
          <Upload className="w-4 h-4" /> {t('exemplarImages.editor.upload')}
          <input ref={fileInput} data-testid="exemplar-upload-input" type="file" multiple disabled={busy}
            accept="image/jpeg,image/png,image/tiff" className="hidden"
            onChange={e => void upload(Array.from(e.target.files ?? []))} />
        </label>
        <p className="w-full text-xs text-gray-500">{t('exemplarImages.editor.dropHint')}</p>
      </div>

      <ol className="space-y-2">
        {draft.map((img, i) => {
          const imported = !!img.source.import_id;
          return (
            <li key={img.id} data-testid="exemplar-editor-row" className="flex flex-wrap items-center gap-2 text-sm border-b border-gray-100 pb-2">
              <span className="w-6 text-gray-400 text-right">{i + 1}</span>
              <button type="button" aria-label={t('exemplarImages.editor.moveUp')} onClick={() => move(i, -1)}
                disabled={busy || i === 0} className="p-1 rounded hover:bg-gray-100 disabled:opacity-30">
                <ArrowUp className="w-4 h-4" />
              </button>
              <button type="button" aria-label={t('exemplarImages.editor.moveDown')} onClick={() => move(i, 1)}
                disabled={busy || i === draft.length - 1} className="p-1 rounded hover:bg-gray-100 disabled:opacity-30">
                <ArrowDown className="w-4 h-4" />
              </button>
              <input aria-label={t('exemplarImages.editor.label')} placeholder={t('exemplarImages.editor.label')}
                value={img.label ?? ''} className={`${input} w-32`} disabled={busy}
                onChange={e => edit(i, { label: opt(e.target.value) })} />
              <input aria-label={t('exemplarImages.editor.page')} placeholder={t('exemplarImages.editor.page')}
                value={img.page ?? ''} className={`${input} w-40`} disabled={busy}
                onChange={e => edit(i, { page: opt(e.target.value) })} />
              {imported ? (
                <span className="text-gray-500" title={t('exemplarImages.editor.importOnlyLicense')}>
                  ADA {img.source.ref}{img.source.page ? `, ${img.source.page}` : ''}
                </span>
              ) : (
                <>
                  <select aria-label={t('exemplarImages.editor.sourceKind')} value={img.source.kind} className={input}
                    disabled={busy} onChange={e => edit(i, {}, { kind: e.target.value as ExemplarImage['source']['kind'] })}>
                    {EDIT_KINDS.map(k => <option key={k} value={k}>{t(`exemplarImages.editor.kinds.${k}`)}</option>)}
                  </select>
                  <input aria-label={t('exemplarImages.editor.sourceRef')} placeholder={t('exemplarImages.editor.sourceRef')}
                    value={img.source.ref ?? ''} className={`${input} flex-1 min-w-[8rem]`} disabled={busy}
                    onChange={e => edit(i, {}, { ref: opt(e.target.value) })} />
                </>
              )}
              <input aria-label={t('exemplarImages.editor.license')} placeholder={t('exemplarImages.editor.license')}
                value={img.source.license ?? ''} className={`${input} w-28`} disabled={busy}
                onChange={e => edit(i, {}, { license: opt(e.target.value) })} />
              <button type="button" aria-label={t('exemplarImages.editor.delete')} onClick={() => void remove(img)}
                disabled={busy} className="p-1 rounded text-red-600 hover:bg-red-50 disabled:opacity-30 ml-auto">
                <Trash2 className="w-4 h-4" />
              </button>
            </li>
          );
        })}
      </ol>

      <div className="flex justify-end gap-2">
        <button type="button" disabled={!isDirty || busy} onClick={() => setDraft(manifest.images)}
          className="px-3 py-1.5 text-sm rounded border border-gray-300 hover:bg-gray-50 disabled:opacity-40">
          {t('common:buttons.cancel')}
        </button>
        <button type="button" disabled={!isDirty || busy} onClick={() => void save()}
          className="px-3 py-1.5 text-sm rounded bg-primary-600 text-white hover:bg-primary-700 disabled:opacity-40">
          {t('exemplarImages.editor.save')}
        </button>
      </div>
      <UnsavedChangesDialog {...dialogProps} />
    </div>
  );
};

export default ExemplarImageEditor;
