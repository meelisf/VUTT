import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { ArrowLeft, Loader2 } from 'lucide-react';
import Header from '../components/Header';
import ImageViewer from '../components/ImageViewer';
import ExemplarImageStrip from '../components/exemplars/ExemplarImageStrip';
import ExemplarCompare, { type WitnessPage } from '../components/exemplars/ExemplarCompare';
import ExemplarImageEditor from '../components/exemplars/ExemplarImageEditor';
import AdaImportDialog from '../components/exemplars/AdaImportDialog';
import { useNotify } from '../contexts/FeedbackContext';
import { useUser } from '../contexts/UserContext';
import { useImageToken, withImageToken } from '../contexts/ImageTokenContext';
import { useMeiliIndex } from '../contexts/MeilisearchContext';
import { getWorkExemplars } from '../services/workApi';
import {
  ManifestConflictError, fetchExemplarImages, patchExemplarImages, sourceLabel, type ExemplarManifest,
} from '../services/exemplarImagesService';
import { apiErrorMessage } from '../services/apiClient';
import { getExemplarImageUrl } from '../services/workImageService';
import { getWorkMetadata, getWorkPageList } from '../services/workService';
import { isAtLeast } from '../utils/roleUtils';
import type { Exemplar } from '../types';

/**
 * Eksemplari vaade (ADR 0079): `/work/:workId/exemplar/:exemplarId?image=…&compare=…`.
 * Pildid sirvimiseks; töövaade (Workspace) neid ei näe.
 */
const ExemplarPage: React.FC = () => {
  const { t } = useTranslation(['workspace', 'common']);
  const { workId = '', exemplarId = '' } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const { user, authToken } = useUser();
  const index = useMeiliIndex();
  // Pikk vaade: allkiri uueneb enne aegumist (nagu teose haldus).
  const imageToken = useImageToken(workId, { refresh: true });
  const canEdit = isAtLeast(user?.role, 'admin');

  const [title, setTitle] = useState<string>('');
  // undefined = laadimisel, null = ei leitud
  const [exemplar, setExemplar] = useState<Exemplar | null | undefined>(undefined);
  const [manifest, setManifest] = useState<ExemplarManifest | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [editing, setEditing] = useState(false);
  const [adaOpen, setAdaOpen] = useState(false);
  const [pageCount, setPageCount] = useState(0);
  const [witnessPages, setWitnessPages] = useState<WitnessPage[] | null>(null);
  const notify = useNotify();

  useEffect(() => {
    let cancelled = false;
    setExemplar(undefined);
    setManifest(null);
    setLoadError(false);
    getWorkExemplars(workId, authToken)
      .then(res => {
        if (cancelled) return;
        setPageCount(res.page_count);
        const found = res.exemplars.find(x => x.id === exemplarId) ?? null;
        setExemplar(found);
        if (!found) return;
        return fetchExemplarImages(workId, exemplarId, authToken).then(m => { if (!cancelled) setManifest(m); });
      })
      .catch(() => { if (!cancelled) setLoadError(true); });
    return () => { cancelled = true; };
  }, [workId, exemplarId, authToken]);

  useEffect(() => {
    if (!index || !workId) return;
    let cancelled = false;
    getWorkMetadata(index, workId).then(w => { if (!cancelled && w) setTitle(w.title || ''); });
    return () => { cancelled = true; };
  }, [index, workId]);

  const reload = useCallback(() => {
    fetchExemplarImages(workId, exemplarId, authToken).then(setManifest).catch(() => setLoadError(true));
  }, [workId, exemplarId, authToken]);

  const compareStem = searchParams.get('compare');
  const comparing = compareStem !== null;

  // Tunnistaja lehed laetakse alles kõrvutamise avamisel.
  useEffect(() => {
    if (!comparing || witnessPages || !index || !pageCount) return;
    let cancelled = false;
    getWorkPageList(index, workId, pageCount).then(p => { if (!cancelled) setWitnessPages(p); });
    return () => { cancelled = true; };
  }, [comparing, witnessPages, index, workId, pageCount]);

  const images = useMemo(() => manifest?.images ?? [], [manifest]);
  const requested = searchParams.get('image');
  const selected = images.find(i => i.id === requested) ?? images[0] ?? null;

  const select = useCallback((imageId: string) => {
    const next = new URLSearchParams(searchParams);
    next.set('image', imageId);
    setSearchParams(next, { replace: true });
  }, [searchParams, setSearchParams]);

  const navigateImage = useCallback((dir: 'prev' | 'next') => {
    if (!selected) return;
    const i = images.findIndex(x => x.id === selected.id) + (dir === 'next' ? 1 : -1);
    if (i >= 0 && i < images.length) select(images[i].id);
  }, [images, selected, select]);

  const setCompare = useCallback((stem: string | null) => {
    const next = new URLSearchParams(searchParams);
    if (stem === null) next.delete('compare'); else next.set('compare', stem);
    setSearchParams(next, { replace: true });
  }, [searchParams, setSearchParams]);

  const savePair = useCallback(async (stem: string) => {
    if (!manifest || !selected) return;
    const updated = manifest.images.map(i => (i.id === selected.id ? { ...i, page: stem } : i));
    try {
      const m = await patchExemplarImages(workId, exemplarId, manifest.revision, updated, authToken);
      setManifest(m);
      notify(t(m.git_committed === false ? 'exemplarImages.editor.notCommitted' : 'exemplarImages.compare.pairSaved'),
        m.git_committed === false ? 'warning' : 'success');
    } catch (e) {
      if (e instanceof ManifestConflictError) {
        notify(t('exemplarImages.editor.conflict'), 'warning');
        setManifest(e.current);
      } else {
        notify(apiErrorMessage(e, t('exemplarImages.editor.error')), 'error');
      }
    }
  }, [manifest, selected, workId, exemplarId, authToken, notify, t]);

  const source = selected ? sourceLabel(selected.source, t) : null;

  return (
    <div className="min-h-screen bg-gray-50">
      <Header />
      <div className="max-w-6xl mx-auto px-4 py-6">
        <Link to={`/work/${workId}`} className="inline-flex items-center gap-1 text-sm text-primary-700 hover:text-primary-900">
          <ArrowLeft className="w-4 h-4" /> {t('exemplarImages.back')}
        </Link>
        {title && <p className="mt-2 text-sm text-gray-600">{title}</p>}

        {loadError && <p className="mt-6 text-red-700">{t('exemplarImages.loadError')}</p>}
        {!loadError && exemplar === undefined && (
          <div className="mt-10 flex justify-center"><Loader2 className="w-6 h-6 animate-spin text-primary-600" /></div>
        )}
        {exemplar === null && <p className="mt-6 text-gray-700">{t('exemplarImages.notFound')}</p>}

        {exemplar && (
          <>
            <div className="mt-2 flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <h1 className="text-xl font-semibold text-gray-900">
                {exemplar.holder}{exemplar.shelfmark ? ` ${exemplar.shelfmark}` : ''}
              </h1>
              {manifest && images.length > 0 && (
                <span className="text-sm text-gray-500">{t('exemplarImages.count', { count: images.length })}</span>
              )}
              <div className="ml-auto flex gap-2">
                {selected && (
                  <button
                    type="button"
                    onClick={() => setCompare(comparing ? null : (selected.page ?? ''))}
                    className="text-sm px-3 py-1.5 rounded border border-gray-300 bg-white hover:bg-gray-50"
                  >
                    {t(comparing ? 'exemplarImages.compare.close' : 'exemplarImages.compare.open')}
                  </button>
                )}
                {canEdit && (
                  <button
                    type="button"
                    onClick={() => setAdaOpen(true)}
                    className="text-sm px-3 py-1.5 rounded border border-gray-300 bg-white hover:bg-gray-50"
                  >
                    {t('exemplarImages.ada.open')}
                  </button>
                )}
                {canEdit && (
                  <button
                    type="button"
                    onClick={() => setEditing(e => !e)}
                    aria-pressed={editing}
                    className="text-sm px-3 py-1.5 rounded border border-gray-300 bg-white hover:bg-gray-50"
                  >
                    {t('exemplarImages.edit')}
                  </button>
                )}
              </div>
            </div>

            {manifest && images.length === 0 && (
              <p className="mt-6 text-gray-600">{t('exemplarImages.empty')}</p>
            )}

            {selected && (
              <div className="mt-4 space-y-3">
                <ExemplarImageStrip
                  workId={workId}
                  exemplarId={exemplarId}
                  images={images}
                  selectedId={selected.id}
                  onSelect={select}
                  imageToken={imageToken}
                />
                {comparing ? (
                  <ExemplarCompare
                    workId={workId}
                    exemplarId={exemplarId}
                    image={selected}
                    pages={witnessPages ?? []}
                    stem={compareStem || null}
                    onStemChange={setCompare}
                    onSavePair={savePair}
                    canEdit={canEdit}
                    imageToken={imageToken}
                  />
                ) : (
                  <div className="h-[70vh] bg-slate-900 rounded relative overflow-hidden">
                    <ImageViewer
                      src={withImageToken(getExemplarImageUrl(workId, exemplarId, selected.id), imageToken)}
                      onNavigate={navigateImage}
                    />
                  </div>
                )}
                <div data-testid="exemplar-source" className="text-sm text-gray-700 flex flex-wrap gap-x-3">
                  {selected.label && <span className="font-medium">{selected.label}</span>}
                  {source && (source.href
                    ? <a href={source.href} target="_blank" rel="noopener noreferrer" className="text-primary-700 hover:text-primary-900">{source.text}</a>
                    : <span>{source.text}</span>)}
                  {selected.source.license && <span className="text-gray-500">{selected.source.license}</span>}
                </div>
              </div>
            )}
            {editing && canEdit && manifest && (
              <ExemplarImageEditor
                workId={workId}
                exemplarId={exemplarId}
                manifest={manifest}
                authToken={authToken}
                onManifest={setManifest}
              />
            )}
            {adaOpen && (
              <AdaImportDialog
                workId={workId}
                exemplarId={exemplarId}
                authToken={authToken}
                onPublished={() => { setAdaOpen(false); reload(); }}
                onClose={() => setAdaOpen(false)}
              />
            )}
          </>
        )}
      </div>
    </div>
  );
};

export default ExemplarPage;
