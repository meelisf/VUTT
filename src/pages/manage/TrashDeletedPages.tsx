import React from 'react';
import { Loader2, RotateCcw, HelpCircle } from 'lucide-react';
import type { DeletedWorkPage } from '../../services/workApi';
import { historyThumbUrl } from './trashGrouping';

interface Props {
  pages: DeletedWorkPage[];
  workId: string;
  token: string | null;
  restoringPage: string | null;
  onRestore: (filename: string) => void;
  t: (key: string, opts?: Record<string, unknown>) => string;
}

/** Kustutatud leheküljed + `unknown` kirjed. Viimased on nähtaval SILDIGA, aga
 *  ilma taastenuputa: fail on kettal olemas, ja nähtamatu kirje on halvem kui
 *  sildistatud (#325). */
const TrashDeletedPages: React.FC<Props> = ({
  pages, workId, token, restoringPage, onRestore, t,
}) => (
  <div className="bg-white rounded-xl border border-gray-200 shadow-sm mb-6">
    <div className="px-5 py-4 border-b border-gray-100">
      <h2 className="font-semibold text-gray-800">
        {t('manage.trash.sectionDeleted')} ({pages.length})
      </h2>
    </div>
    {pages.length === 0 ? (
      <p className="p-5 text-sm text-gray-400">{t('manage.trash.empty')}</p>
    ) : (
      <div className="divide-y divide-gray-100">
        {pages.map((p) => (
          <div key={p.filename} className="flex items-center gap-3 px-5 py-3">
            <img
              src={historyThumbUrl(workId, 'trash', p.filename, p.v, token)}
              alt=""
              loading="lazy"
              className="h-16 w-12 flex-shrink-0 rounded border border-gray-200 bg-gray-50 object-contain"
            />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-gray-700 font-mono truncate">{p.filename}</p>
              {p.deleted_at && (
                <p className="text-xs text-gray-400 mt-0.5">
                  {t('manage.trash.deletedAt')}: {new Date(p.deleted_at).toLocaleString('et-EE', {
                    day: '2-digit', month: '2-digit', year: 'numeric',
                    hour: '2-digit', minute: '2-digit',
                  })}
                  {p.deleted_by && ` · ${p.deleted_by}`}
                </p>
              )}
              {!p.restorable && (
                <p className="mt-1 flex items-start gap-1 text-xs text-amber-700">
                  <HelpCircle size={12} className="mt-0.5 shrink-0" />
                  <span>
                    <strong>{t('manage.trash.badgeUnknown')}</strong> — {t('manage.trash.unknownHint')}
                  </span>
                </p>
              )}
            </div>
            {p.restorable && (
              <button
                onClick={() => onRestore(p.filename)}
                disabled={restoringPage === p.filename}
                className="flex-shrink-0 flex items-center gap-1.5 px-3 py-1.5 text-sm bg-primary-600 hover:bg-primary-700 text-white rounded transition-colors disabled:opacity-50"
              >
                {restoringPage === p.filename ? (
                  <><Loader2 size={13} className="animate-spin" />{t('manage.trash.restoring')}</>
                ) : (
                  <><RotateCcw size={13} />{t('manage.trash.restore')}</>
                )}
              </button>
            )}
          </div>
        ))}
      </div>
    )}
  </div>
);

export default TrashDeletedPages;
