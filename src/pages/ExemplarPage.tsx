import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ArrowLeft, Copy, Loader2 } from 'lucide-react';
import Header from '../components/Header';
import UnsavedChangesDialog from '../components/UnsavedChangesDialog';
import ExemplarList, { type ExemplarListHandle } from '../components/exemplars/ExemplarList';
import ExemplarMaterial from '../components/exemplars/ExemplarMaterial';
import ExemplarImageModal from '../components/exemplars/ExemplarImageModal';
import ExemplarCompareModal, { type CompareSide } from '../components/exemplars/ExemplarCompareModal';
import {
  PAGES_KEY, defaultSelection, imagesSequence, materialParts, pagesSequence, type Sequence,
} from '../components/exemplars/exemplarSequences';
import { orderExemplars } from '../components/exemplars/exemplarCardUtils';
import { useNotify } from '../contexts/FeedbackContext';
import { useUser } from '../contexts/UserContext';
import { useImageToken, withImageToken } from '../contexts/ImageTokenContext';
import { useMeiliIndex } from '../contexts/MeilisearchContext';
import { useUnsavedChangesGuard } from '../hooks/useUnsavedChangesGuard';
import { getWorkExemplars, type WorkExemplarsResponse } from '../services/workApi';
import {
  ManifestConflictError, fetchExemplarImages, patchExemplarImages, sourceLabel, type ExemplarManifest,
} from '../services/exemplarImagesService';
import { apiErrorMessage, apiGet } from '../services/apiClient';
import { getWorkMetadata } from '../services/workService';
import { FILE_API_URL } from '../config';
import { isAtLeast } from '../utils/roleUtils';
import { isManuscriptType } from '../utils/metadataUtils';

type Archives = Record<string, { name: string; url?: string }>;
const EMPTY_MANIFEST: ExemplarManifest = { revision: 0, images: [], imports: {} };

/** `?cmp=<vasak jada>:<indeks>~<parem jada>:<indeks>`; vigane → null (kõrvutust ei avata). */
export function parseCompareParam(raw: string | null): [CompareSide, CompareSide] | null {
  if (!raw) return null;
  const sides = raw.split('~');
  if (sides.length !== 2) return null;
  const out: CompareSide[] = [];
  for (const part of sides) {
    const m = /^([A-Za-z0-9_-]+):(\d+)$/.exec(part);
    if (!m) return null;
    out.push({ seq: m[1], index: Number(m[2]) });
  }
  return [out[0], out[1]];
}

const compareParam = (l: CompareSide, r: CompareSide) => `${l.seq}:${l.index}~${r.seq}:${r.index}`;

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
  // Kõrvutuse jadade jaoks: kõigi piltidega eksemplaride manifestid (laetakse avamisel).
  const [otherManifests, setOtherManifests] = useState<Record<string, ExemplarManifest>>({});
  const [listDirty, setListDirty] = useState(false);
  const notify = useNotify();
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
  const manifestOf = (eid: string): ExemplarManifest | undefined =>
    (manifestState?.eid === eid ? manifestState.m : undefined) ?? otherManifests[eid];

  // ── Kõrvutus ──────────────────────────────────────────────────────────────
  const cmp = parseCompareParam(searchParams.get('cmp'));
  const withImages = data ? orderExemplars(data.exemplars).filter(x => (data.images?.[x.id]?.count ?? 0) > 0) : [];
  const canCompare = !!data && ((data.page_files?.length ?? 0) > 0 ? 1 : 0) + withImages.length >= 2;
  const missingManifests = withImages.filter(x => !manifestOf(x.id)).map(x => x.id);
  const missingKey = missingManifests.join(',');
  useEffect(() => {
    if (!cmp || !missingKey) return;
    let cancelled = false;
    for (const eid of missingKey.split(',')) {
      fetchExemplarImages(workId, eid, authToken)
        .then(m => { if (!cancelled) setOtherManifests(prev => ({ ...prev, [eid]: m })); })
        .catch(() => { if (!cancelled) setOtherManifests(prev => ({ ...prev, [eid]: EMPTY_MANIFEST })); });
    }
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [!!cmp, missingKey, workId, authToken]);

  const compareSeqs: Sequence[] | null = data && cmp && missingManifests.length === 0 ? [
    pagesSequence(workId, data),
    ...orderExemplars(data.exemplars).map(x =>
      imagesSequence(workId, x.id, manifestOf(x.id)?.images ?? [], data.page_numbers)),
  ] : null;
  const cmpValid = !!(compareSeqs && cmp && cmp.every(side => {
    const seq = compareSeqs.find(q => q.key === side.seq);
    return !!seq && side.index < seq.items.length;
  }));

  /** Kõrvutuse avamine: vasak = kust vajutati; parem = paari leht → ?page → algus. */
  const openCompare = (seqKey: string, item: { key: string; stem?: string; pairStem?: string } | undefined) => {
    if (!data || !item) return;
    const all = pagesSequence(workId, data);
    const pageIdx = (stem?: string) => (stem ? all.items.findIndex(it => it.stem === stem) : -1);
    let left: CompareSide;
    if (seqKey === PAGES_KEY) {
      left = { seq: PAGES_KEY, index: Math.max(0, pageIdx(item.stem)) };
    } else {
      const imgs = manifestOf(seqKey)?.images ?? [];
      left = { seq: seqKey, index: Math.max(0, imgs.findIndex(im => im.id === item.key)) };
    }
    let right: CompareSide;
    if (left.seq !== PAGES_KEY && all.items.length > 0) {
      let i = pageIdx(item.pairStem);
      if (i < 0 && backPage) i = Math.min(backPage - 1, all.items.length - 1);
      right = { seq: PAGES_KEY, index: Math.max(0, i) };
    } else {
      const other = withImages.find(x => x.id !== left.seq);
      right = other ? { seq: other.id, index: 0 } : { seq: PAGES_KEY, index: 0 };
    }
    const next = new URLSearchParams(searchParams);
    next.delete('image');
    next.set('cmp', compareParam(left, right));
    setSearchParams(next, { replace: true });
  };

  const setCompare = (l: CompareSide, r: CompareSide) => {
    const next = new URLSearchParams(searchParams);
    next.set('cmp', compareParam(l, r));
    setSearchParams(next, { replace: true });
  };
  const closeCompare = () => {
    const next = new URLSearchParams(searchParams);
    next.delete('cmp');
    setSearchParams(next, { replace: true });
  };

  const storeManifest = (eid: string, m: ExemplarManifest) => {
    setOtherManifests(prev => ({ ...prev, [eid]: m }));
    if (manifestState?.eid === eid) setManifestState({ eid, m });
  };

  /** Paari salvestus: pildi `page` uueks tüveks. 409 (revisjon või kadunud leht) →
   *  teade, manifest veast ja leheloend serverist uuesti. */
  const savePair = async (eid: string, imageKey: string, stem: string) => {
    const m = manifestOf(eid);
    if (!m) return;
    const images = m.images.map(im => (im.id === imageKey ? { ...im, page: stem } : im));
    try {
      const out = await patchExemplarImages(workId, eid, m.revision, images, authToken);
      storeManifest(eid, out);
      notify(t(out.git_committed === false ? 'exemplarImages.editor.notCommitted' : 'compare.pairSaved'),
        out.git_committed === false ? 'warning' : 'success');
    } catch (e) {
      if (e instanceof ManifestConflictError) {
        notify(t('exemplarImages.editor.conflict'), 'warning');
        storeManifest(eid, e.current);
        void loadData();
      } else {
        notify(apiErrorMessage(e, t('exemplarImages.editor.error')), 'error');
      }
    }
  };

  const seqLabel = (key: string) => {
    if (!data) return { main: key };
    if (key === PAGES_KEY) {
      const w = data.exemplars.find(x => x.text_witness);
      return {
        main: t('compare.pagesSeq'),
        sub: w ? t('compare.witnessIs', { name: [w.holder, w.shelfmark].filter(Boolean).join(' ') }) : t('compare.witnessUnset'),
      };
    }
    const x = data.exemplars.find(e => e.id === key);
    const n = data.images?.[key]?.count ?? 0;
    return {
      main: x ? [x.holder, x.shelfmark].filter(Boolean).join(' ') : key,
      sub: n ? t('exemplarImages.count', { count: n }) : t('compare.noMaterial'),
    };
  };

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
                canEdit={canEdit} canCompare={canCompare} imageToken={imageToken} authToken={authToken}
                onOpen={openItem}
                onCompare={(seqKey, i) => openCompare(seqKey, seqs.find(q => q.key === seqKey)?.items[i])}
                onManifest={m => { if (selectedExemplar) setManifestState({ eid: selectedExemplar.id, m }); void loadData(); }}
                onImported={() => { if (selectedExemplar) void loadManifest(selectedExemplar.id); void loadData(); }} />
            )}
          </div>
        )}
      </div>

      {open && data && (
        <ExemplarImageModal title={modalTitle} sequence={open.seq} index={open.index}
          onIndex={i => setImage(open.seq.items[i]?.key ?? null)} onClose={() => setImage(null)}
          sourceLine={sourceLine} pageNumbers={data.page_numbers} sign={u => withImageToken(u, imageToken)}
          onCompare={canCompare ? () => openCompare(open.seq.kind === 'pages' ? PAGES_KEY : open.seq.key,
            open.seq.items[open.index]) : undefined} />
      )}
      {cmp && cmpValid && compareSeqs && (
        <ExemplarCompareModal title={title} sequences={compareSeqs} seqLabel={seqLabel}
          left={cmp[0]} right={cmp[1]} onChange={setCompare} canEdit={canEdit}
          onSavePair={canEdit ? savePair : undefined} onClose={closeCompare}
          sign={u => withImageToken(u, imageToken)} />
      )}
      <UnsavedChangesDialog {...dialogProps} />
    </div>
  );
};

export default ExemplarPage;
