import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ArrowLeft, Copy, Loader2 } from 'lucide-react';
import Header from '../components/Header';
import UnsavedChangesDialog from '../components/UnsavedChangesDialog';
import ExemplarList, { type ExemplarListHandle } from '../components/exemplars/ExemplarList';
import ExemplarMaterial from '../components/exemplars/ExemplarMaterial';
import ExemplarImageModal from '../components/exemplars/ExemplarImageModal';
import {
  PAGES_KEY, defaultSelection, materialParts, type Sequence,
} from '../components/exemplars/exemplarSequences';
import { useUser } from '../contexts/UserContext';
import { useImageToken, withImageToken } from '../contexts/ImageTokenContext';
import { useMeiliIndex } from '../contexts/MeilisearchContext';
import { useUnsavedChangesGuard } from '../hooks/useUnsavedChangesGuard';
import { getWorkExemplars, type WorkExemplarsResponse } from '../services/workApi';
import { fetchExemplarImages, sourceLabel, type ExemplarManifest } from '../services/exemplarImagesService';
import { apiGet } from '../services/apiClient';
import { getWorkMetadata } from '../services/workService';
import { FILE_API_URL } from '../config';
import { isAtLeast } from '../utils/roleUtils';
import { isManuscriptType } from '../utils/metadataUtils';

type Archives = Record<string, { name: string; url?: string }>;
const EMPTY_MANIFEST: ExemplarManifest = { revision: 0, images: [], imports: {} };

/**
 * Eksemplari leht (spets 2026-11-10, ADR 0076/0079): `/work/:workId/exemplar/:exemplarId?`.
 *
 * `:exemplarId` = eksemplari id või `pages` (rida „Teose lehed", alus märkimata);
 * puudub → vaikimisi valik (`defaultSelection`), mis kirjutatakse URL-i `replace`-iga.
 * `?image=<võti>` = suur pilt avatud; `?page=N` = töölaual avatud leht (tagasilink).
 *
 * Leheloend tuleb `GET /works/{id}/exemplars` vastusest (kettalt), MITTE Meilist.
 * Kirje toimetamine käib `ExemplarList`-is; töövaade eksemplari pilte ei näe.
 */
const ExemplarPage: React.FC = () => {
  const { t } = useTranslation(['workspace', 'common']);
  const { workId = '', exemplarId } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const { user, authToken } = useUser();
  const index = useMeiliIndex();
  // Pikk vaade: allkiri uueneb enne aegumist (nagu teose haldus).
  const imageToken = useImageToken(workId, { refresh: true });
  const canEdit = isAtLeast(user?.role, 'admin') && !!authToken;

  const [data, setData] = useState<WorkExemplarsResponse | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [title, setTitle] = useState('');
  const [isManuscript, setIsManuscript] = useState(false);
  const [archives, setArchives] = useState<Archives>({});
  // Manifest koos eksemplari id-ga: teise eksemplari vana manifest ei tohi vilksatada.
  const [manifestState, setManifestState] = useState<{ eid: string; m: ExemplarManifest } | null>(null);
  const [listDirty, setListDirty] = useState(false);
  const listRef = useRef<ExemplarListHandle>(null);

  const pageParam = searchParams.get('page');
  const backPage = pageParam && /^\d+$/.test(pageParam) ? Number(pageParam) : null;
  const pageQuery = backPage ? `?page=${backPage}` : '';

  const loadData = useCallback(async () => {
    try {
      setData(await getWorkExemplars(workId, authToken));
      setLoadError(false);
    } catch {
      setLoadError(true);
    }
  }, [workId, authToken]);

  useEffect(() => { void loadData(); }, [loadData]);

  useEffect(() => {
    if (!index || !workId) return;
    let cancelled = false;
    getWorkMetadata(index, workId).then(w => {
      if (cancelled || !w) return;
      setTitle(w.title || '');
      setIsManuscript(isManuscriptType(w.type));
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [index, workId]);

  useEffect(() => {
    apiGet<{ archives?: Archives }>(`${FILE_API_URL}/config/archives`)
      .then(d => { if (d?.archives) setArchives(d.archives); })
      .catch(() => {});
  }, []);

  // Id-ta aadress → vaikimisi valik URL-i (jagatav link näitab sama).
  const fallback = data ? defaultSelection(data) : null;
  useEffect(() => {
    if (!exemplarId && fallback) {
      navigate(`/work/${workId}/exemplar/${fallback}${pageQuery}`, { replace: true });
    }
  }, [exemplarId, fallback, workId, pageQuery, navigate]);

  const selected = exemplarId ?? fallback;
  const selectedExemplar = data?.exemplars.find(x => x.id === selected) ?? null;
  const imageCount = selectedExemplar ? data?.images?.[selectedExemplar.id]?.count ?? 0 : 0;

  const loadManifest = useCallback(async (eid: string) => {
    try {
      const m = await fetchExemplarImages(workId, eid, authToken);
      setManifestState({ eid, m });
    } catch {
      setManifestState({ eid, m: EMPTY_MANIFEST });
    }
  }, [workId, authToken]);

  useEffect(() => {
    const eid = selectedExemplar?.id;
    if (!eid) return;
    // Pildita eksemplari manifesti vajab ainult toimetaja (üleslaadimine).
    if (imageCount > 0 || canEdit) void loadManifest(eid);
    else setManifestState({ eid, m: EMPTY_MANIFEST });
  }, [selectedExemplar?.id, imageCount, canEdit, loadManifest]);

  const manifest = manifestState && manifestState.eid === selectedExemplar?.id ? manifestState.m : null;

  const { dialogProps } = useUnsavedChangesGuard({
    isDirty: listDirty,
    onSave: () => listRef.current?.saveDraft() ?? Promise.resolve(true),
  });

  const select = (key: string) => navigate(`/work/${workId}/exemplar/${key}${pageQuery}`);

  // Suur pilt: võti otsitakse valitud võtme jadadest (oma pildid, siis teose lehed).
  const parts = data && selected && (selected === PAGES_KEY || selectedExemplar)
    ? materialParts(workId, data, selected, manifest?.images ?? null) : null;
  const seqs: Sequence[] = parts ? [parts.images, parts.pages].filter((s): s is Sequence => !!s) : [];
  const imageKey = searchParams.get('image');
  const open = (() => {
    if (!imageKey) return null;
    for (const seq of seqs) {
      const i = seq.items.findIndex(it => it.key === imageKey);
      if (i >= 0) return { seq, index: i };
    }
    return null;
  })();

  const setImage = (key: string | null) => {
    const next = new URLSearchParams(searchParams);
    if (key) next.set('image', key); else next.delete('image');
    setSearchParams(next, { replace: true });
  };
  const openItem = (seqKey: string, i: number) => {
    const seq = seqs.find(s => s.key === seqKey);
    const it = seq?.items[i];
    if (it) setImage(it.key);
  };

  const openImage = open && open.seq.kind === 'images'
    ? manifest?.images.find(im => im.id === open.seq.items[open.index].key) : undefined;
  const sourceLine = openImage
    ? (() => {
      const s = sourceLabel(openImage.source, t);
      return { text: [s.text, openImage.source.license].filter(Boolean).join(' · '), href: s.href };
    })()
    : undefined;

  const modalTitle = selectedExemplar
    ? [selectedExemplar.holder, selectedExemplar.shelfmark].filter(Boolean).join(' ')
    : t('exemplarPage.pagesRow');

  const notFound = !!data && !!selected && selected !== PAGES_KEY && !selectedExemplar;

  return (
    <div className="min-h-screen bg-gray-50">
      <Header />
      <div className="max-w-4xl mx-auto px-4 py-8">
        <div className="flex items-center gap-3 mb-6">
          <Link to={backPage ? `/work/${workId}/${backPage}` : `/work/${workId}`}
            className="flex items-center gap-1.5 text-sm text-gray-600 hover:text-gray-900 transition-colors">
            <ArrowLeft size={16} />
            {backPage ? t('exemplarPage.backToPage', { n: backPage }) : t('exemplarImages.back')}
          </Link>
        </div>

        <div className="flex items-center gap-3 mb-6">
          <div className="p-2 bg-sky-100 rounded-lg">
            <Copy size={20} className="text-sky-700" />
          </div>
          <div className="min-w-0">
            <h1 className="text-xl font-bold text-gray-900">{t('exemplarPage.title')}</h1>
            {title && <p className="text-sm text-gray-500 mt-0.5">{title}</p>}
          </div>
        </div>

        {loadError && <p className="mb-4 text-sm text-red-700">{t('exemplars.loadError')}</p>}
        {!loadError && !data && (
          <div className="mt-10 flex justify-center"><Loader2 className="w-6 h-6 animate-spin text-primary-600" /></div>
        )}

        {data && (
          <div className="space-y-6">
            <ExemplarList ref={listRef} workId={workId} authToken={authToken} userRole={user?.role}
              isManuscript={isManuscript} data={data} archives={archives}
              onArchiveAdded={(id, info) => setArchives(prev => ({ ...prev, [id]: info }))}
              selected={selected} onSelect={select} onChanged={loadData} onDirtyChange={setListDirty} />

            {notFound && <p className="text-sm text-gray-600">{t('exemplarImages.notFound')}</p>}

            {selected && !notFound && (
              <ExemplarMaterial workId={workId} selected={selected} data={data} manifest={manifest}
                canEdit={canEdit} canCompare={false} imageToken={imageToken} authToken={authToken}
                onOpen={openItem} onCompare={() => {}}
                onManifest={m => { if (selectedExemplar) setManifestState({ eid: selectedExemplar.id, m }); void loadData(); }}
                onImported={() => { if (selectedExemplar) void loadManifest(selectedExemplar.id); void loadData(); }} />
            )}
          </div>
        )}
      </div>

      {open && data && (
        <ExemplarImageModal title={modalTitle} sequence={open.seq} index={open.index}
          onIndex={i => setImage(open.seq.items[i]?.key ?? null)} onClose={() => setImage(null)}
          sourceLine={sourceLine} pageNumbers={data.page_numbers} sign={u => withImageToken(u, imageToken)} />
      )}
      <UnsavedChangesDialog {...dialogProps} />
    </div>
  );
};

export default ExemplarPage;
