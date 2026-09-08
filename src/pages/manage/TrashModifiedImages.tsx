import React from 'react';
import { Loader2, RotateCcw } from 'lucide-react';
import type { ModifiedImage } from '../../services/workApi';
import { historyThumbUrl } from './trashGrouping';

interface Props {
  images: ModifiedImage[];
  workId: string;
  token: string | null;
  restoringOriginal: string | null;
  onRestoreOriginal: (filename: string) => void;
  t: (key: string, opts?: Record<string, unknown>) => string;
}

/** Tegevuse kood → tõlkevõti. Tundmatu kood kuvatakse toorelt, mitte ei kao:
 *  vaikiv väljajätmine peidaks uue backend-välja. */
const TEGEVUSE_VOTI: Record<string, string> = {
  crop: 'manage.trash.actionCrop',
  rotate: 'manage.trash.actionRotate',
  quad: 'manage.trash.actionQuad',
  restore: 'manage.trash.actionRestore',
};

const TrashModifiedImages: React.FC<Props> = ({
  images, workId, token, restoringOriginal, onRestoreOriginal, t,
}) => (
  <div className="bg-white rounded-xl border border-gray-200 shadow-sm mb-6">
    <div className="px-5 py-4 border-b border-gray-100">
      <h2 className="font-semibold text-gray-800">
        {t('manage.trash.sectionModified')} ({images.length})
      </h2>
    </div>
    {images.length === 0 ? (
      <p className="p-5 text-sm text-gray-400">{t('manage.trash.empty')}</p>
    ) : (
      <div className="divide-y divide-gray-100">
        {images.map((i) => (
          <div key={i.filename} className="flex items-center gap-3 px-5 py-3">
            {/* Enne JA pärast kõrvuti: just siin peab inimene ära tundma, mis
                kadus. `object-contain`, sest `object-cover` lõikaks topeltlehe
                servad — täpselt selle info, mida vaadatakse. Klõps avab
                pisipildi omaette aknas. */}
            <div className="flex flex-shrink-0 items-end gap-2">
              {([['original', i.v, 'manage.trash.beforeLabel'],
                 ['current', i.v_current, 'manage.trash.afterLabel']] as const).map(
                ([kind, versioon, silt]) => (
                  <figure key={kind} className="m-0 w-16">
                    <a
                      href={historyThumbUrl(workId, kind, i.filename, versioon, token)}
                      target="_blank"
                      rel="noreferrer"
                    >
                      <img
                        src={historyThumbUrl(workId, kind, i.filename, versioon, token)}
                        alt=""
                        loading="lazy"
                        className="h-20 w-16 rounded border border-gray-200 bg-gray-50 object-contain"
                      />
                    </a>
                    <figcaption className="mt-0.5 text-center text-[10px] uppercase tracking-wide text-gray-400">
                      {t(silt)}
                    </figcaption>
                  </figure>
                ),
              )}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-gray-700">
                {t('manage.trash.pageLabel', { page: i.page })}
                <span className="text-gray-500">
                  {' · '}
                  {i.action.length > 0
                    ? i.action.map((a) => (TEGEVUSE_VOTI[a] ? t(TEGEVUSE_VOTI[a]) : a)).join(', ')
                    : t('manage.trash.actionModified')}
                </span>
              </p>
              <p className="text-xs text-gray-400 mt-0.5 font-mono truncate">{i.filename}</p>
              {i.at && (
                <p className="text-xs text-gray-400">
                  {new Date(i.at).toLocaleString('et-EE', {
                    day: '2-digit', month: '2-digit', year: 'numeric',
                    hour: '2-digit', minute: '2-digit',
                  })}
                  {i.by && ` · ${i.by}`}
                </p>
              )}
            </div>
            <button
              onClick={() => onRestoreOriginal(i.filename)}
              disabled={restoringOriginal === i.filename}
              className="flex-shrink-0 flex items-center gap-1.5 px-3 py-1.5 text-sm border border-primary-600 text-primary-700 hover:bg-primary-50 rounded transition-colors disabled:opacity-50"
            >
              {restoringOriginal === i.filename ? (
                <><Loader2 size={13} className="animate-spin" />{t('manage.trash.restoring')}</>
              ) : (
                <><RotateCcw size={13} />{t('manage.trash.restoreOriginal')}</>
              )}
            </button>
          </div>
        ))}
      </div>
    )}
  </div>
);

export default TrashModifiedImages;
