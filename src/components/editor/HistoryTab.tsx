import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { History, RotateCcw, Shield, User, AlertTriangle, Loader2 } from 'lucide-react';
import { Page, PageStatus } from '../../types';
import { FILE_API_URL } from '../../config';

// Git ajaloo kirje tüüp
interface GitHistoryEntry {
  hash: string;
  full_hash: string;
  author: string;
  date: string;
  formatted_date: string;
  message: string;
  is_original: boolean;
}

interface HistoryTabProps {
  page: Page;
  user: any;
  authToken: string | null;
  onRestore: (content: string) => void;
  readOnly: boolean;
}

const HistoryTab: React.FC<HistoryTabProps> = ({ 
  page,
  user,
  authToken,
  onRestore,
  readOnly
}) => {
  const { t } = useTranslation(['workspace', 'common']);
  
  // Git ajaloo state
  const [gitHistory, setGitHistory] = useState<GitHistoryEntry[]>([]);
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);
  const [isRestoring, setIsRestoring] = useState(false);

  const loadGitHistory = async () => {
    if (!page.original_path || !page.image_url) {
      console.warn("Ei saa Git ajalugu laadida: puudub original_path või image_url");
      return;
    }

    if (!authToken) {
      alert("Ajaloo laadimiseks pead olema sisse logitud. Palun logi välja ja uuesti sisse.");
      return;
    }

    setIsLoadingHistory(true);
    try {
      const imagePath = page.image_url.split('/').pop() || '';
      const txtFilename = imagePath.replace(/\.(jpg|jpeg|png|gif)$/i, '.txt');

      const response = await fetch(`${FILE_API_URL}/git-history`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          original_path: page.original_path,
          file_name: txtFilename,
          auth_token: authToken
        })
      });

      const data = await response.json();
      if (data.status === 'success') {
        setGitHistory(data.history || []);
      } else {
        console.error("Git ajaloo laadimine ebaõnnestus:", data.message);
        if (data.message?.includes('Autentimine') || data.message?.includes('parool')) {
          alert("Autentimine ebaõnnestus. Palun logi välja ja uuesti sisse.");
        }
      }
    } catch (e) {
      console.error("Git ajaloo laadimine ebaõnnestus:", e);
    } finally {
      setIsLoadingHistory(false);
    }
  };

  const handleGitRestore = async (entry: GitHistoryEntry) => {
    if (!page.original_path || !page.image_url) {
      alert("Taastamine ebaõnnestus: puudub vajalik info");
      return;
    }

    if (!authToken) {
      alert("Taastamiseks pead olema sisse logitud. Palun logi välja ja uuesti sisse.");
      return;
    }

    const confirmMsg = entry.is_original
      ? `Kas soovid taastada ORIGINAAL OCR versiooni?\n\nAutor: ${entry.author}\nKuupäev: ${entry.formatted_date}`
      : `Kas soovid taastada versiooni?\n\nAutor: ${entry.author}\nKuupäev: ${entry.formatted_date}\n\nTekst laaditakse redaktorisse. Muudatuste salvestamiseks pead vajutama "Salvesta".`;

    if (!confirm(confirmMsg)) {
      return;
    }

    setIsRestoring(true);
    try {
      const imagePath = page.image_url.split('/').pop() || '';
      const txtFilename = imagePath.replace(/\.(jpg|jpeg|png|gif)$/i, '.txt');

      const response = await fetch(`${FILE_API_URL}/git-restore`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          original_path: page.original_path,
          file_name: txtFilename,
          commit_hash: entry.full_hash,
          auth_token: authToken
        })
      });

      const data = await response.json();
      if (data.status === 'success' && data.restored_content !== undefined) {
        onRestore(data.restored_content);
        alert(`Versioon ${entry.formatted_date} (${entry.author}) laaditud redaktorisse.\n\nSalvestamiseks vajuta "Salvesta" nuppu.`);
        loadGitHistory();
      } else {
        alert(`Taastamine ebaõnnestus: ${data.message || 'Tundmatu viga'}`);
      }
    } catch (e: any) {
      console.error("Taastamine ebaõnnestus:", e);
      alert(`Taastamine ebaõnnestus: ${e.message || 'Võrgu viga'}`);
    } finally {
      setIsRestoring(false);
    }
  };

  return (
    <div className="h-full bg-gray-50 p-6 overflow-y-auto">
      {/* Muudatuste ajalugu (Meilisearchist) */}
      <div className="bg-white p-5 rounded-lg border border-gray-200 shadow-sm mb-6">
        <div className="flex items-center gap-2 mb-6 text-gray-800 border-b border-gray-100 pb-2">
          <History size={18} className="text-primary-600" />
          <h4 className="font-bold">{t('history.title')}</h4>
        </div>

        <div className="relative border-l-2 border-gray-200 ml-3 space-y-8">
          {page.history?.map((entry, idx) => (
            <div key={entry.id} className="relative pl-6">
              <span className={`absolute -left-[9px] top-1 w-4 h-4 rounded-full border-2 border-white ${entry.action === 'status_change' ? 'bg-blue-500' :
                entry.action === 'text_edit' ? 'bg-green-500' : 'bg-gray-400'
                }`}></span>
              <div className="flex flex-col sm:flex-row sm:justify-between sm:items-baseline mb-1">
                <span className="text-sm font-bold text-gray-900">{entry.user}</span>
                <span className="text-xs text-gray-500 font-mono">{new Date(entry.timestamp).toLocaleString('et-EE')}</span>
              </div>
              <p className="text-sm text-gray-600">{entry.description}</p>
              {entry.action === 'status_change' && (
                <span className="inline-block mt-1 text-xs px-2 py-0.5 bg-blue-50 text-blue-700 rounded border border-blue-100">
                  {t('history.action.status_change')}
                </span>
              )}
            </div>
          ))}
          {(!page.history || page.history.length === 0) && (
            <p className="text-sm text-gray-400 pl-6">{t('history.noBackups')}</p>
          )}
        </div>
      </div>

      {/* Git versiooniajalugu (ainult admin näeb) */}
      {user?.role === 'admin' && (
        <div className="bg-white p-5 rounded-lg border border-gray-200 shadow-sm">
          <div className="flex items-center justify-between mb-4 border-b border-gray-100 pb-2">
            <div className="flex items-center gap-2 text-gray-800">
              <RotateCcw size={18} className="text-amber-600" />
              <h4 className="font-bold">{t('history.gitHistory')}</h4>
            </div>
            <button
              onClick={loadGitHistory}
              disabled={isLoadingHistory}
              className="text-xs px-3 py-1 bg-gray-100 hover:bg-gray-200 rounded text-gray-700 transition-colors"
            >
              {isLoadingHistory ? t('common:labels.loading') : t('history.refresh')}
            </button>
          </div>

          {gitHistory.length === 0 && !isLoadingHistory && (
            <p className="text-sm text-gray-400 text-center py-4">{t('history.emptyHistory')}</p>
          )}

          {gitHistory.length > 0 && (
            <div className="space-y-2">
              {gitHistory.map((entry) => (
                <div
                  key={entry.full_hash}
                  className={`flex items-center justify-between p-3 rounded-lg border ${entry.is_original
                    ? 'bg-green-50 border-green-200'
                    : 'bg-gray-50 border-gray-200 hover:bg-gray-100'
                    }`}
                >
                  <div className="flex items-center gap-3 flex-1 min-w-0">
                    {entry.is_original && (
                      <div title="Originaal OCR - esimene versioon">
                        <Shield size={16} className="text-green-600" />
                      </div>
                    )}
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-medium text-gray-900">
                          {entry.formatted_date}
                        </span>
                        <span className="text-xs text-gray-500 font-mono">
                          {entry.hash}
                        </span>
                        {entry.is_original && (
                          <span className="text-xs px-2 py-0.5 bg-green-100 text-green-700 rounded">
                            Originaal OCR
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-1 text-xs text-gray-500 mt-1">
                        <User size={10} />
                        <span>{entry.author}</span>
                      </div>
                    </div>
                  </div>

                  <button
                    onClick={() => handleGitRestore(entry)}
                    disabled={isRestoring || readOnly}
                    className={`text-xs px-3 py-1.5 ${entry.is_original
                      ? 'bg-green-600 hover:bg-green-700'
                      : 'bg-primary-600 hover:bg-primary-700'
                      } disabled:bg-gray-300 text-white rounded transition-colors flex items-center gap-1 shrink-0 ml-2`}
                  >
                    {isRestoring ? (
                      <Loader2 size={12} className="animate-spin" />
                    ) : (
                      <RotateCcw size={12} />
                    )}
                    {entry.is_original ? t('history.original') : t('history.restore')}
                  </button>
                </div>
              ))}
            </div>
          )}

          <p className="mt-4 text-xs text-gray-500">
            <AlertTriangle size={12} className="inline mr-1" />
            {t('history.restoreHint')}
          </p>
        </div>
      )}

      {user && user.role !== 'admin' && (
        <div className="bg-gray-100 p-4 rounded-lg text-center text-sm text-gray-500">
          {t('history.adminOnly')}
        </div>
      )}
    </div>
  );
};

export default HistoryTab;
