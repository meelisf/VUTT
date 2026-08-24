/**
 * Upload leht — admin teose lisamine PDF-ist OCR kaudu.
 *
 * Õhuke orkestreerija: kogu viisardi olek/loogika elab `useUploadWizard` hookis,
 * see fail ainult renderdab sammud ja pooleliolevate nimekirja.
 */
import React, { useEffect } from 'react';
import { isAtLeast } from '../../utils/roleUtils';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router-dom';
import {
  Upload as UploadIcon,
  ChevronLeft,
  Loader2,
  Trash2,
  AlertTriangle,
  X,
  Info,
  ListTodo,
} from 'lucide-react';
import Header from '../../components/Header';
import StepIndicator from './components/StepIndicator';
import UploadStepMeta from './components/UploadStepMeta';
import UploadStepTransfer from './components/UploadStepTransfer';
import UploadStepReview from './components/UploadStepReview';
import UploadStepSplit from './components/UploadStepSplit';
import { TYPE_HAND, TYPE_PRINT } from './constants';
import { useUploadWizard } from './useUploadWizard';
import { useUser } from '../../contexts/UserContext';
import { useCollection } from '../../contexts/CollectionContext';
import { getLangCode } from '../../utils/getLangCode';

// ---------------------------------------------------------------------------
// Peakomponent
// ---------------------------------------------------------------------------

const UploadPage: React.FC = () => {
  const { t, i18n } = useTranslation(['upload', 'common']);
  const { user, authToken, isLoading: authLoading } = useUser();
  const { collections } = useCollection();
  const navigate = useNavigate();
  const lang = getLangCode(i18n.language);

  const wizard = useUploadWizard();

  // ---------------------------------------------------------------------------
  // Auth redirect — oota async initAuth() lõppu enne suunamist
  // ---------------------------------------------------------------------------
  useEffect(() => {
    if (authLoading) return;
    if (!user || !isAtLeast(user.role, 'admin')) navigate('/');
  }, [user, navigate, authLoading]);

  // Kollektsioonide loend (sortimine nime järgi)
  const collectionList = Object.entries(collections).sort(([, a], [, b]) => {
    const nameA = typeof a.name === 'object' ? (a.name[lang] ?? a.name['et'] ?? '') : String(a.name);
    const nameB = typeof b.name === 'object' ? (b.name[lang] ?? b.name['et'] ?? '') : String(b.name);
    return nameA.localeCompare(nameB, lang);
  });

  const stepLabels: [string, string, string, string] = [
    t('steps.metadata'),
    t('steps.upload'),
    t('steps.split'),
    t('steps.review'),
  ];

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------
  return (
    <div className="min-h-screen bg-gray-50">
      <Header pageTitle={t('title')} pageTitleIcon={<UploadIcon size={20} className="text-primary-600" />} />

      <div className="max-w-5xl mx-auto px-4 py-8">
        <Link to="/admin" className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700 mb-6">
          <ChevronLeft size={16} />
          Admin
        </Link>

        {/* Pooleliolevad üleslaadimised (ainult kui ühtegi aktiivset pole) */}
        {!wizard.uploadId && (
          <div className="mb-8">
            {wizard.loadingPending ? (
              <div className="flex items-center gap-2 text-gray-500 text-sm">
                <Loader2 size={16} className="animate-spin" />
                <span>Laen...</span>
              </div>
            ) : wizard.pendingUploads.length > 0 ? (
              <div className="bg-white rounded-xl border border-gray-200 p-4 shadow-sm">
                <h2 className="font-semibold text-gray-800 mb-3 text-sm">{t('pending.title')}</h2>
                <div className="space-y-2">
                  {wizard.pendingUploads.map((u) => {
                    const canResume = [
                      'pending', 'uploading', 'awaiting_split', 'prepping', 'applying',
                      'processing', 'reviewing', 'done',
                    ].includes(u.status);
                    const isError = u.status === 'error';
                    const isImported = u.status === 'imported';
                    return (
                    <div
                      key={u.id}
                      className="flex items-center justify-between p-3 rounded-lg bg-gray-50 border border-gray-200"
                    >
                      <div>
                        <p className="font-medium text-gray-900 text-sm">{u.meta.title}</p>
                        <p className="text-xs text-gray-500">
                          {u.meta.year} · data/{u.meta.slug}/ ·{' '}
                          <span
                            className={`font-medium ${
                              u.status === 'done' || u.status === 'imported'
                                ? 'text-green-600'
                                : u.status === 'error'
                                ? 'text-red-500'
                                : 'text-amber-600'
                            }`}
                          >
                            {t(`status.${u.status}`, u.status)}
                          </span>
                          {u.stalled && (
                            <span
                              className="ml-2 inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-800 align-middle"
                              title={t('pending.stalledHint')}
                            >
                              <AlertTriangle size={11} />
                              {t('pending.stalled')}
                            </span>
                          )}
                        </p>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        {canResume && (
                          <button
                            onClick={() => wizard.handleResume(u)}
                            className="text-sm font-medium text-primary-600 hover:text-primary-800 px-3 py-1.5 rounded-md hover:bg-primary-50 transition-colors"
                          >
                            {t('pending.resume')}
                          </button>
                        )}
                        <button
                          onClick={() => wizard.handleDeletePending(u.id)}
                          className={`text-sm font-medium px-3 py-1.5 rounded-md transition-colors ${
                            isError || isImported
                              ? 'text-red-600 hover:text-red-800 hover:bg-red-50'
                              : 'text-gray-400 hover:text-red-600 hover:bg-red-50'
                          }`}
                          title={t('cancel')}
                        >
                          <X size={15} />
                        </button>
                      </div>
                    </div>
                    );
                  })}
                </div>
              </div>
            ) : null}
          </div>
        )}

        {/* Sammuindikaator */}
        <StepIndicator step={wizard.step} labels={stepLabels} />

        {/* Eelteade: ainult samm 2-s enne faili valimist (samm 3-s on oma inline teade) */}
        {wizard.step === 2 && !wizard.fileUploading && (
          <div className="mb-6 p-4 bg-blue-50 border border-blue-300 rounded-xl text-sm text-blue-900 flex items-start gap-3 shadow-sm">
            <Info size={18} className="shrink-0 mt-0.5 text-blue-600" />
            <div>
              <p className="font-semibold mb-0.5">{t('notice.title')}</p>
              <p className="text-blue-800">{t('notice.body')}</p>
            </div>
          </div>
        )}

        {/* ------------------------------------------------------------------ */}
        {/* SAMM 1: Metaandmed                                                  */}
        {/* ------------------------------------------------------------------ */}
        {wizard.step === 1 && (
          <UploadStepMeta
            title={wizard.title}
            setTitle={wizard.setTitle}
            year={wizard.year}
            setYear={wizard.setYear}
            workType={wizard.workType}
            setWorkType={wizard.setWorkType}
            typePrint={TYPE_PRINT}
            typeHand={TYPE_HAND}
            slug={wizard.slug}
            selectedCollection={wizard.selectedCollection}
            setSelectedCollection={wizard.setSelectedCollection}
            collectionList={collectionList}
            lang={lang}
            step1Loading={wizard.step1Loading}
            step1Error={wizard.step1Error}
            autoCreateLoading={wizard.autoCreateLoading}
            autoCreateError={wizard.autoCreateError}
            replaceWorkId={wizard.replaceWorkId}
            replaceWorkTitle={wizard.replaceWorkTitle}
            onReplaceDismiss={wizard.handleReplaceDismiss}
            onSubmit={wizard.handleStep1Submit}
            t={t}
          />
        )}

        {/* ------------------------------------------------------------------ */}
        {/* SAMM 2: Faili üleslaadimine                                         */}
        {/* ------------------------------------------------------------------ */}
        {wizard.step === 2 && (
          <UploadStepTransfer
            title={wizard.title}
            year={wizard.year}
            slug={wizard.slug}
            fileUploading={wizard.fileUploading}
            pendingMultiFiles={wizard.pendingMultiFiles}
            multiCurrentNum={wizard.multiCurrentNum}
            multiTotalNum={wizard.multiTotalNum}
            status={wizard.status}
            progress={wizard.progress}
            progressPct={wizard.progressPct}
            estimatedTime={wizard.estimatedTime}
            sending={wizard.sending}
            sendEta={wizard.sendEta}
            uploadError={wizard.uploadError}
            dragging={wizard.dragging}
            setDragging={wizard.setDragging}
            fileInputRef={wizard.fileInputRef}
            onDrop={wizard.handleDrop}
            onFilesSelected={wizard.handleFilesSelected}
            onMultipleImageUpload={wizard.handleMultipleImageUpload}
            onClearPendingMultiFiles={() => wizard.setPendingMultiFiles([])}
            t={t}
          />
        )}

        {/* ------------------------------------------------------------------ */}
        {/* SAMM 3: Topeltlehtede poolitamine (opt-in)                          */}
        {/* ------------------------------------------------------------------ */}
        {wizard.step === 3 && wizard.uploadId && (
          <UploadStepSplit
            uploadId={wizard.uploadId}
            token={authToken}
            onDone={wizard.handlePrepressApplied}
          />
        )}

        {/* ------------------------------------------------------------------ */}
        {/* SAMM 4: Ülevaatus                                                   */}
        {/* ------------------------------------------------------------------ */}
        {wizard.step === 4 && (
          <UploadStepReview
            status={wizard.status}
            pollResult={wizard.pollResult}
            readyCount={wizard.readyCount}
            placeholderPages={wizard.placeholderPages}
            filesWithLocalDeleted={wizard.filesWithLocalDeleted}
            uploadId={wizard.uploadId}
            authToken={authToken}
            userRole={user?.role || 'contributor'}
            collections={collections}
            title={wizard.title}
            year={wizard.year}
            selectedCollection={wizard.selectedCollection}
            replaceWorkId={wizard.replaceWorkId}
            replaceWorkTitle={wizard.replaceWorkTitle}
            fileUploading={wizard.fileUploading}
            ocrTimedOut={wizard.ocrTimedOut}
            onBackToSplit={() => wizard.setStep(3)}
            estimatedTime={wizard.estimatedTime}
            importError={wizard.importError}
            canImport={wizard.canImport}
            importLoading={wizard.importLoading}
            onImport={wizard.handleImport}
            onReplaceImport={wizard.handleReplaceImport}
            t={t}
          />
        )}

        {/* Alumised nupud (samm 2 ja 3) */}
        {wizard.step > 1 && (
          <div className="mt-4 space-y-2">
            {wizard.fileUploading ? (
              /* Upload käib taustal — näita "Sulge" ja "Katkesta" eraldi.
                 Saatmise ajal (brauser → server) "Sulge" EI TOHI paista: see
                 lahkuks lehelt ja katkestaks poolelioleva üleslaadimise. */
              <>
                {!wizard.sending && (
                <button
                  onClick={wizard.handleClose}
                  className="w-full flex items-center justify-center gap-2 border border-primary-300 text-primary-700 hover:bg-primary-50 font-medium py-2.5 px-4 rounded-lg transition-colors text-sm"
                >
                  <ListTodo size={15} />
                  {t('closeAndMonitor')}
                </button>
                )}
                <div className="flex justify-center">
                  <button
                    onClick={wizard.handleCancel}
                    className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-red-600 transition-colors"
                  >
                    <Trash2 size={12} />
                    {t('cancelUpload')}
                  </button>
                </div>
              </>
            ) : (
              /* Faili pole veel valitud — lihtsalt katkesta viisard */
              <div className="flex justify-center">
                <button
                  onClick={wizard.handleCancel}
                  className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-red-600 transition-colors"
                >
                  <X size={14} />
                  {t('cancelWizard')}
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default UploadPage;
