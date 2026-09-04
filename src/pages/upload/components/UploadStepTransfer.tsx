import React from 'react';
import { AlertTriangle, FileUp, Info, Loader2 } from 'lucide-react';

interface UploadProgress {
  bytes_sent: number;
  bytes_total: number;
  error?: string | null;
  /** ADA-voog: mitu allikfaili on tükeldatult valmis (vt server/ada/fetch.py). */
  files_done?: number;
  files_total?: number;
}

interface UploadStepTransferProps {
  title: string;
  year: string;
  slug: string;
  fileUploading: boolean;
  pendingMultiFiles: File[];
  multiCurrentNum: number;
  multiTotalNum: number;
  status: string;
  progress?: UploadProgress;
  progressPct: number;
  /** OCR-i ajahinnang, või null kui lehekülgede arv on veel teadmata. */
  estimatedTime: string | null;
  /** Fail liigub praegu brauserist serverisse — lehelt lahkumine katkestaks selle. */
  sending: boolean;
  /** Mõõdetud jäänud aeg saatmisele (nt "43 min"); null kui veel mõõtmata. */
  sendEta: string | null;
  uploadError: string;
  dragging: boolean;
  setDragging: (value: boolean) => void;
  fileInputRef: React.RefObject<HTMLInputElement | null>;
  onDrop: (e: React.DragEvent) => void;
  onFilesSelected: (files: File[]) => void;
  onMultipleImageUpload: (files: File[]) => void;
  onClearPendingMultiFiles: () => void;
  /** ADA-voog: serveri veateade (`ada_error`), kui backend selle andis. */
  adaError?: string;
  /** ADA-voog: „Laen uuesti" — CAS lubab `ada_error → ada_fetching`,
   *  juba kettal olevaid tükke ei tõmmata uuesti. */
  onAdaRetry: () => void;
  t: (key: string, options?: Record<string, unknown>) => string;
}

const UploadStepTransfer: React.FC<UploadStepTransferProps> = ({
  title,
  year,
  slug,
  fileUploading,
  pendingMultiFiles,
  multiCurrentNum,
  multiTotalNum,
  status,
  progress,
  progressPct,
  estimatedTime,
  sending,
  sendEta,
  uploadError,
  dragging,
  setDragging,
  fileInputRef,
  onDrop,
  onFilesSelected,
  onMultipleImageUpload,
  onClearPendingMultiFiles,
  adaError,
  onAdaRetry,
  t,
}) => (
  <div className="bg-white rounded-xl border border-gray-200 p-6 shadow-sm">
    <h2 className="text-lg font-semibold text-gray-900 mb-5">{t('step2.title')}</h2>

    {/* Teose info */}
    <div className="mb-5 p-3 bg-gray-50 rounded-lg text-sm text-gray-600 border border-gray-200">
      <span className="font-medium text-gray-800">{title}</span>
      {' · '}
      {year}
      {' · '}
      <span className="font-mono text-xs">data/{slug}/</span>
    </div>

    {/* Upload progress (kui SFTP käib) */}
    {fileUploading && (status === 'ada_fetching' || status === 'ada_error') ? (
      /* ADA-voog: server tõmbab failid ise (kuni 65 tükki, ~320 MB) — siin
         näidatakse allalaadimise progressi, mitte failivalijat (Task 11). */
      <div className="space-y-3">
        {status === 'ada_fetching' ? (
          <>
            <div className="flex items-center gap-3">
              <Loader2 size={20} className="animate-spin text-primary-600 shrink-0" />
              <p className="text-sm font-medium text-gray-800">{t('ada.downloading')}</p>
            </div>
            {progress && progress.bytes_total > 0 && (
              <div>
                <div className="flex justify-between text-xs text-gray-500 mb-1">
                  <span>{t('step2.progressLabel').replace('{{pct}}', String(progressPct))}</span>
                  <span>
                    {t('ada.downloadProgress', {
                      done: progress.files_done ?? 0,
                      total: progress.files_total ?? 0,
                      mbDone: Math.round(progress.bytes_sent / 1024 / 1024),
                      mbTotal: Math.round(progress.bytes_total / 1024 / 1024),
                    })}
                  </span>
                </div>
                <div className="w-full bg-gray-200 rounded-full h-2">
                  <div
                    className="bg-primary-600 h-2 rounded-full transition-all duration-300"
                    style={{ width: `${progressPct}%` }}
                  />
                </div>
              </div>
            )}
          </>
        ) : (
          <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700 space-y-2">
            <div className="flex items-start gap-2">
              <AlertTriangle size={16} className="shrink-0 mt-0.5" />
              <span>{adaError || t('ada.errorFallback')}</span>
            </div>
            <button
              type="button"
              onClick={onAdaRetry}
              className="text-sm font-medium text-primary-700 hover:text-primary-900 underline"
            >
              {t('ada.retry')}
            </button>
          </div>
        )}
      </div>
    ) : fileUploading ? (
      <div className="space-y-3">
        <div className="flex items-center gap-3">
          <Loader2 size={20} className="animate-spin text-primary-600 shrink-0" />
          <p className="text-sm font-medium text-gray-800">
            {multiTotalNum > 1
              ? t('step2.uploadingMulti')
                  .replace('{{current}}', String(multiCurrentNum))
                  .replace('{{total}}', String(multiTotalNum))
              : sending
              ? t('step2.sendingToServer')
              : status === 'uploading'
              ? t('step2.uploading')
              : t('step2.processing')}
          </p>
        </div>

        {/* Saatmise faas: lehelt lahkumine KATKESTAB — teistsugune teade kui hiljem */}
        {sending ? (
          <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg text-sm text-amber-800 flex items-start gap-2">
            <AlertTriangle size={16} className="shrink-0 mt-0.5" />
            <span>
              {sendEta
                ? t('step2.sendingNote', { time: sendEta })
                : t('step2.sendingNoteNoEta')}
            </span>
          </div>
        ) : multiTotalNum > 1 ? (
          <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg text-sm text-amber-800 flex items-start gap-2">
            <AlertTriangle size={16} className="shrink-0 mt-0.5" />
            <span>{t('step2.multipleImagesNote')}</span>
          </div>
        ) : (
          <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg text-sm text-blue-800 flex items-start gap-2">
            <Info size={16} className="shrink-0 mt-0.5" />
            <span>
              {estimatedTime
                ? t('step2.canLeaveNote', { time: estimatedTime })
                : t('step2.canLeaveNoteUnknown')}
            </span>
          </div>
        )}

        {/* Progress bar (ainult üksiku faili upload ajaks) */}
        {multiTotalNum <= 1 && status === 'uploading' && progress && progress.bytes_total > 0 && (
          <div>
            <div className="flex justify-between text-xs text-gray-500 mb-1">
              <span>{t('step2.progressLabel').replace('{{pct}}', String(progressPct))}</span>
              <span>
                {Math.round(progress.bytes_sent / 1024 / 1024)} /{' '}
                {Math.round(progress.bytes_total / 1024 / 1024)} MB
              </span>
            </div>
            <div className="w-full bg-gray-200 rounded-full h-2">
              <div
                className="bg-primary-600 h-2 rounded-full transition-all duration-300"
                style={{ width: `${progressPct}%` }}
              />
            </div>
          </div>
        )}

        {/* Multi-image progress bar */}
        {multiTotalNum > 1 && (
          <div>
            <div className="w-full bg-gray-200 rounded-full h-2">
              <div
                className="bg-primary-600 h-2 rounded-full transition-all duration-300"
                style={{ width: `${Math.round(((multiCurrentNum - 1) / multiTotalNum) * 100)}%` }}
              />
            </div>
          </div>
        )}

        {/* Veateade progressis */}
        {progress?.error && (
          <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
            <AlertTriangle size={14} className="inline mr-1" />
            {progress.error}
          </div>
        )}
      </div>
    ) : pendingMultiFiles.length > 0 ? (
      /* Mitu pilti valitud — näita nimekirja ja "Laadi üles" nuppu */
      <>
        <p className="text-sm text-gray-700 mb-2">
          {t('step2.multiFilesSelected').replace('{{n}}', String(pendingMultiFiles.length))}
        </p>
        <ul className="mb-4 max-h-48 overflow-y-auto border border-gray-200 rounded-lg divide-y divide-gray-100 text-sm">
          {pendingMultiFiles.map((f, i) => (
            <li key={i} className="px-3 py-1.5 flex items-center gap-2 text-gray-700">
              <span className="text-xs text-gray-400 w-5 text-right shrink-0">{i + 1}.</span>
              <span className="font-mono truncate">{f.name}</span>
            </li>
          ))}
        </ul>
        <button
          onClick={() => onMultipleImageUpload(pendingMultiFiles)}
          className="w-full flex items-center justify-center gap-2 bg-primary-600 hover:bg-primary-700 text-white font-medium py-2.5 px-4 rounded-lg transition-colors text-sm mb-2"
        >
          <FileUp size={16} />
          {t('step2.uploadAllBtn')}
        </button>
        <button
          onClick={onClearPendingMultiFiles}
          className="w-full text-sm text-gray-400 hover:text-gray-700 py-1 transition-colors"
        >
          {t('cancelWizard')} (vali uuesti)
        </button>
        {uploadError && (
          <div className="mt-3 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
            <AlertTriangle size={14} className="inline mr-1" />
            {uploadError}
          </div>
        )}
      </>
    ) : (
      /* Drag & drop tsoon */
      <>
        {/* collecting_images resume teade */}
        {status === 'collecting_images' && (
          <div className="mb-3 p-3 bg-amber-50 border border-amber-200 rounded-lg text-sm text-amber-800 flex items-start gap-2">
            <AlertTriangle size={16} className="shrink-0 mt-0.5" />
            <span>{t('step2.collectingImages')}</span>
          </div>
        )}
        <div
          onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
          onClick={() => fileInputRef.current?.click()}
          className={`border-2 border-dashed rounded-xl p-10 text-center cursor-pointer transition-colors ${
            dragging
              ? 'border-primary-400 bg-primary-50'
              : 'border-gray-300 hover:border-primary-400 hover:bg-gray-50'
          }`}
        >
          <FileUp
            size={36}
            className={`mx-auto mb-3 ${dragging ? 'text-primary-500' : 'text-gray-400'}`}
          />
          <p className="text-sm font-medium text-gray-700">
            {dragging ? t('step2.dropzoneActive') : t('step2.dropzone')}
          </p>
          <p className="text-xs text-gray-400 mt-1">PDF · JPG · PNG · mitu JPG/PNG korraga</p>
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept=".pdf,.jpg,.jpeg,.png,.tif,.tiff,application/pdf,image/jpeg,image/png,image/tiff"
          multiple
          className="hidden"
          onChange={(e) => {
            const files = Array.from(e.target.files ?? []);
            if (files.length > 0) onFilesSelected(files);
            // Lähtesta input et sama failivalik toimiks uuesti
            e.target.value = '';
          }}
        />

        {uploadError && (
          <div className="mt-3 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
            <AlertTriangle size={14} className="inline mr-1" />
            {uploadError}
          </div>
        )}
      </>
    )}
  </div>
);

export default UploadStepTransfer;
