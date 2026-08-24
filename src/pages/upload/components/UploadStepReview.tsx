import React from 'react';
import { AlertTriangle, CheckCircle, Clock, Info, Loader2 } from 'lucide-react';
import UploadMetaForm from '../../../components/UploadMetaForm';
import { FILE_API_URL } from '../../../config';
import type { Collections } from '../../../services/collectionService';
import type { FileEntry, PollResult } from '../types';

/** Kohatäide lehele, mille pilti veel ei ole — näitab töö KUJU kohe. */
const PlaceholderCard: React.FC<{ page: number }> = ({ page }) => (
  <div className="relative rounded-lg overflow-hidden border-2 border-gray-200">
    <div className="aspect-[3/4] bg-gray-100 animate-pulse" />
    <div className="px-2 py-1 text-xs font-medium flex items-center justify-between bg-gray-50 text-gray-400">
      <span>Lk {page}</span>
    </div>
  </div>
);

const ThumbCard: React.FC<{
  entry: FileEntry;
  uploadId: string;
  authToken: string;
  t: (key: string) => string;
}> = ({ entry, uploadId, authToken, t }) => {
  const thumbUrl = `${FILE_API_URL}/admin/upload/${uploadId}/thumb/${entry.page}?token=${authToken}`;
  // Ebaõnnestunud leht EI ole ootel: OCR-server ei võta .err-iga lehte enam ette
  // (#250). Ilma selle haruta keerleks spinner igavesti ja valetaks kasutajale.
  const failed = !entry.has_ocr && !!entry.ocr_error;

  return (
    <div
      className={`relative rounded-lg overflow-hidden border-2 transition-all ${
        entry.has_ocr
          ? 'border-green-400'
          : failed
            ? 'border-red-300'
            : 'border-yellow-300'
      }`}
      title={entry.ocr_error || undefined}
    >
      {/* Pisipilt */}
      <div className="aspect-[3/4] bg-gray-100 flex items-center justify-center overflow-hidden">
        {entry.has_ocr ? (
          <img
            src={thumbUrl}
            alt={`Lk ${entry.page}`}
            className="w-full h-full object-contain"
            loading="lazy"
          />
        ) : failed ? (
          <AlertTriangle size={24} className="text-red-500" />
        ) : (
          <Loader2 size={24} className="text-yellow-500 animate-spin" />
        )}
      </div>

      {/* Staatusriba */}
      <div
        className={`px-2 py-1 text-xs font-medium flex items-center justify-between ${
          entry.has_ocr
            ? 'bg-green-50 text-green-700'
            : failed
              ? 'bg-red-50 text-red-700'
              : 'bg-yellow-50 text-yellow-700'
        }`}
      >
        <span>Lk {entry.page}</span>
        <span>
          {entry.has_ocr
            ? t('step3.ocrReady')
            : failed
              ? t('step3.ocrFailed')
              : t('step3.ocrProcessing')}
        </span>
      </div>
    </div>
  );
};

interface UploadStepReviewProps {
  status: string;
  pollResult: PollResult | null;
  readyCount: number;
  placeholderPages: number[];
  filesWithLocalDeleted: FileEntry[];
  uploadId: string | null;
  authToken: string | null;
  userRole: string;
  collections: Collections;
  title: string;
  year: string;
  selectedCollection: string;
  replaceWorkId: string | null;
  replaceWorkTitle: string | null;
  fileUploading: boolean;
  ocrTimedOut: boolean;
  onBackToSplit?: () => void;
  /** OCR-i ajahinnang, või null kui lehekülgede arv on veel teadmata. */
  estimatedTime: string | null;
  importError: string;
  canImport: boolean;
  importLoading: boolean;
  onImport: () => void;
  onReplaceImport: () => void;
  t: (key: string, options?: Record<string, unknown>) => string;
}

const UploadStepReview: React.FC<UploadStepReviewProps> = ({
  status,
  pollResult,
  readyCount,
  placeholderPages,
  filesWithLocalDeleted,
  uploadId,
  authToken,
  userRole,
  collections,
  title,
  year,
  selectedCollection,
  replaceWorkId,
  replaceWorkTitle,
  fileUploading,
  ocrTimedOut,
  onBackToSplit,
  estimatedTime,
  importError,
  canImport,
  importLoading,
  onImport,
  onReplaceImport,
  t,
}) => (
  <div className="bg-white rounded-xl border border-gray-200 p-6 shadow-sm">
    <div className="flex items-center justify-between mb-5">
      <h2 className="text-lg font-semibold text-gray-900">{t('step3.title')}</h2>
      <div className="flex items-center gap-2 text-sm">
        {status === 'error' ? (
          <span className="flex items-center gap-1 text-red-600 font-medium">
            <AlertTriangle size={16} />
            {t('status.error')}
          </span>
        ) : status === 'done' ? (
          <span className="flex items-center gap-1 text-green-600 font-medium">
            <CheckCircle size={16} />
            {t('step3.done')}
          </span>
        ) : pollResult?.stalled ? (
          <span
            className="flex items-center gap-1 text-amber-700 font-medium"
            title={t('pending.stalledHint')}
          >
            <AlertTriangle size={16} />
            {t('pending.stalled')}
          </span>
        ) : (
          <span className="flex items-center gap-1 text-amber-600 font-medium">
            <Clock size={16} />
            {t('step3.processing')}
          </span>
        )}
      </div>
    </div>

    {/* OCR statistika */}
    <div className="flex gap-4 text-sm text-gray-600 mb-4">
      <span>
        {t('step3.readyCount')
          .replace('{{ready}}', String(readyCount))
          .replace('{{total}}', String(filesWithLocalDeleted.filter((f) => !f.deleted).length))}
      </span>
      {pollResult?.expected_pages && (
        <span className="text-gray-400">
          {t('step3.expectedPages').replace('{{n}}', String(pollResult.expected_pages))}
        </span>
      )}
    </div>

    {/* Metaandmete muutmine OCR ootamise ajal ja pärast */}
    {uploadId && authToken && (
      <UploadMetaForm
        uploadId={uploadId}
        authToken={authToken}
        userRole={userRole}
        collections={collections}
        initialTitle={title}
        initialYear={year}
        initialCollections={selectedCollection ? [selectedCollection] : []}
        replaceWorkId={replaceWorkId}
        replaceWorkTitle={replaceWorkTitle}
      />
    )}

    {/* Info: OCR käib taustal, saab lahkuda */}
    {fileUploading && !ocrTimedOut && (
      <div className="mb-4 p-3 bg-blue-50 border border-blue-200 rounded-lg text-sm text-blue-800 flex items-start gap-2">
        <Info size={16} className="shrink-0 mt-0.5" />
        <span>
          {estimatedTime
            ? t('step3.canLeaveNote', { time: estimatedTime })
            : t('step3.canLeaveNoteUnknown')}
        </span>
      </div>
    )}

    {/* OCR timeout hoiatus */}
    {ocrTimedOut && (
      <div className="mb-4 p-3 bg-amber-50 border border-amber-200 rounded-lg text-sm text-amber-800 flex items-start gap-2">
        <AlertTriangle size={16} className="shrink-0 mt-0.5" />
        <span>{t('step3.timeoutWarning')}</span>
      </div>
    )}

    {/* Edastuse viga: EI tohi näidata "töötleb" spinnerit, kui midagi ei tööta */}
    {status === 'error' && (
      <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">
        <div className="flex items-start gap-2">
          <AlertTriangle size={16} className="mt-0.5 shrink-0" />
          <div>
            <p className="font-medium">{t('step3.transferFailed')}</p>
            {pollResult?.error && (
              <p className="mt-1 font-mono text-xs text-red-700">{pollResult.error}</p>
            )}
            {onBackToSplit && (
              <button
                type="button"
                onClick={onBackToSplit}
                className="mt-2 rounded border border-red-300 bg-white px-3 py-1 text-sm font-medium text-red-700 hover:bg-red-100"
              >
                {t('step3.backToSplit')}
              </button>
            )}
          </div>
        </div>
      </div>
    )}

    {/* Pisipiltide ruudustik */}
    {filesWithLocalDeleted.length === 0 && placeholderPages.length === 0 ? (
      status === 'error' ? null : (
      <div className="flex items-center justify-center h-32 text-gray-400 text-sm">
        <Loader2 size={20} className="animate-spin mr-2" />
        <span>{t('step2.processing')}</span>
      </div>
      )
    ) : (
      <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-2 mb-6">
        {filesWithLocalDeleted.map((entry) =>
          uploadId && authToken ? (
            <ThumbCard
              key={entry.page}
              entry={entry}
              uploadId={uploadId}
              authToken={authToken}
              t={(key) => t(key)}
            />
          ) : null
        )}
        {/* Kohatäited lehtedele, mida server pole veel avaldanud (#255 arutelu):
            kasutaja näeb töö kuju kohe, mitte alles esimeste valmis lehtede järel. */}
        {placeholderPages.map((page) => <PlaceholderCard key={`ph-${page}`} page={page} />)}
      </div>
    )}

    {/* Impordi nupp */}
    {importError && (
      <div className="mb-3 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
        <AlertTriangle size={14} className="inline mr-1" />
        {importError}
      </div>
    )}
    {replaceWorkId && replaceWorkTitle ? (
      <button
        onClick={onReplaceImport}
        disabled={!canImport}
        title={canImport ? '' : status !== 'done' ? t('step3.importDisabledOcr') : t('step3.importDisabled')}
        className="w-full flex items-center justify-center gap-2 bg-red-600 hover:bg-red-700 disabled:bg-gray-300 text-white font-medium py-2.5 px-4 rounded-lg transition-colors text-sm"
      >
        {importLoading ? (
          <Loader2 size={16} className="animate-spin" />
        ) : (
          <AlertTriangle size={16} />
        )}
        {t('replaceWork.replaceBtn', { title: replaceWorkTitle ?? '' })}
      </button>
    ) : (
      <button
        onClick={onImport}
        disabled={!canImport}
        title={canImport ? '' : status !== 'done' ? t('step3.importDisabledOcr') : t('step3.importDisabled')}
        className="w-full flex items-center justify-center gap-2 bg-green-600 hover:bg-green-700 disabled:bg-gray-300 text-white font-medium py-2.5 px-4 rounded-lg transition-colors text-sm"
      >
        {importLoading ? (
          <Loader2 size={16} className="animate-spin" />
        ) : (
          <CheckCircle size={16} />
        )}
        {t('step3.importBtn')}
      </button>
    )}
  </div>
);

export default UploadStepReview;
