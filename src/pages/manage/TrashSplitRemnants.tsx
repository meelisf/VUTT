import React, { useState } from 'react';
import { Info } from 'lucide-react';
import type { DeletedWorkPage } from '../../services/workApi';
import { historyThumbUrl } from './trashGrouping';

interface Props {
  pages: DeletedWorkPage[];
  workId: string;
  token: string | null;
  t: (key: string, opts?: Record<string, unknown>) => string;
}

/** Poolituse jäägid: kahe elava lehe LÄHTEPILDID. Taastenuppu ei ole — juhis
 *  on ploki päises ÜKS kord, mitte iga kirje juures (#325). */
const TrashSplitRemnants: React.FC<Props> = ({ pages, workId, token, t }) => {
  const [avatud, setAvatud] = useState(false);
  if (pages.length === 0) return null;
  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm mb-6">
      <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
        <h2 className="font-semibold text-gray-800">
          {t('manage.trash.sectionSplit')} ({pages.length})
        </h2>
        <button
          onClick={() => setAvatud((v) => !v)}
          className="text-xs px-3 py-1 bg-gray-100 hover:bg-gray-200 rounded text-gray-600"
        >
          {avatud ? t('manage.trash.hideSplit') : t('manage.trash.showSplit')}
        </button>
      </div>
      {avatud && (
        <>
          <div className="m-5 mb-0 flex items-start gap-2 rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm text-blue-800">
            <Info size={16} className="mt-0.5 shrink-0" />
            <span className="whitespace-pre-line">{t('manage.trash.splitHint')}</span>
          </div>
          <div className="divide-y divide-gray-100 mt-4">
            {pages.map((p) => (
              <div key={p.filename} className="flex items-center gap-3 px-5 py-3">
                <img
                  src={historyThumbUrl(workId, 'trash', p.filename, p.v, token)}
                  alt=""
                  loading="lazy"
                  className="h-16 w-12 flex-shrink-0 rounded border border-gray-200 bg-gray-50 object-contain"
                />
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-gray-700 font-mono truncate">{p.filename}</p>
                  {p.deleted_at && (
                    <p className="text-xs text-gray-400 mt-0.5">
                      {new Date(p.deleted_at).toLocaleString('et-EE', {
                        day: '2-digit', month: '2-digit', year: 'numeric',
                        hour: '2-digit', minute: '2-digit',
                      })}
                      {p.deleted_by && ` · ${p.deleted_by}`}
                    </p>
                  )}
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
};

export default TrashSplitRemnants;
