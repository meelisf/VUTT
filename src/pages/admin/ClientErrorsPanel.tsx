import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, RefreshCw, Trash2, ChevronDown, ChevronRight } from 'lucide-react';
import { FILE_API_URL } from '../../config';
import { fetchWithTimeout, getAuthHeaders } from '../../utils/fetchWithTimeout';

interface ClientError {
  received_at: string;
  message: string;
  stack: string | null;
  url: string | null;
  user_agent: string | null;
  source: string | null;
  username: string | null;
  ip: string | null;
}

/** Kliendi- ja serveripoolsete vigade vaade (#133). Serveri kirjetel on
 * `source` kujul `server:thread` / `server:http`.
 *
 * Enne seda oli ainus signaal „kasutaja kirjutab meili". Logi on kaetud ring
 * (server hoiab viimased N), seega siin ei pagineerita. */
const ClientErrorsPanel: React.FC<{ token?: string }> = ({ token }) => {
  const { t, i18n } = useTranslation(['admin', 'common']);
  const [errors, setErrors] = useState<ClientError[]>([]);
  const [max, setMax] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [expanded, setExpanded] = useState<number | null>(null);
  const [clearing, setClearing] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    setLoadError(false);
    fetchWithTimeout(`${FILE_API_URL}/admin/client-errors`, { headers: getAuthHeaders(token) })
      .then(r => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then(d => { setErrors(d.errors ?? []); setMax(d.max ?? null); })
      .catch(() => setLoadError(true))
      .finally(() => setLoading(false));
  }, [token]);

  useEffect(() => { load(); }, [load]);

  const clearAll = () => {
    setClearing(true);
    fetchWithTimeout(`${FILE_API_URL}/admin/client-errors`, {
      method: 'DELETE', headers: getAuthHeaders(token),
    })
      .then(() => { setErrors([]); setExpanded(null); })
      .catch(() => setLoadError(true))
      .finally(() => setClearing(false));
  };

  const formatTime = (iso: string) => {
    try {
      // Server kirjutab UTC (konteiner on UTC, host EEST) — kuva kohalikus ajas.
      return new Date(iso).toLocaleString(i18n.language === 'en' ? 'en-GB' : 'et-EE');
    } catch {
      return iso;
    }
  };

  return (
    <div className="mb-6">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-gray-700 flex items-center gap-1.5">
          <AlertTriangle size={15} className="text-gray-500" />
          {t('admin:clientErrors.title', 'Vealogi (klient ja server)')}
          {errors.length > 0 && (
            <span className="text-xs font-normal text-gray-500">
              ({errors.length}{max ? ` / ${max}` : ''})
            </span>
          )}
        </h3>
        <div className="flex items-center gap-2">
          <button
            onClick={load}
            disabled={loading}
            className="flex items-center gap-1 text-xs text-primary-600 hover:text-primary-800 border border-primary-200 rounded px-2 py-1 hover:bg-primary-50 disabled:opacity-50"
          >
            <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
            {t('common:refresh', 'Värskenda')}
          </button>
          {errors.length > 0 && (
            <button
              onClick={clearAll}
              disabled={clearing}
              className="flex items-center gap-1 text-xs text-red-600 hover:text-red-800 border border-red-200 rounded px-2 py-1 hover:bg-red-50 disabled:opacity-50"
            >
              <Trash2 size={12} />
              {t('admin:clientErrors.clear', 'Tühjenda')}
            </button>
          )}
        </div>
      </div>

      {loadError && (
        <p className="text-xs text-red-600 mb-2">
          {t('admin:clientErrors.loadError', 'Vigade laadimine ebaõnnestus.')}
        </p>
      )}

      {!loading && !loadError && errors.length === 0 && (
        <p className="text-xs text-gray-500 bg-gray-50 border border-gray-200 rounded-lg p-3">
          {t('admin:clientErrors.empty', 'Vigu ei ole registreeritud.')}
        </p>
      )}

      {errors.length > 0 && (
        <ul className="border border-gray-200 rounded-lg divide-y divide-gray-100 overflow-hidden">
          {errors.map((e, i) => (
            <li key={`${e.received_at}-${i}`} className="bg-white">
              <button
                type="button"
                onClick={() => setExpanded(expanded === i ? null : i)}
                className="w-full text-left px-3 py-2 hover:bg-gray-50 flex items-start gap-2"
                aria-expanded={expanded === i}
              >
                <span className="text-gray-400 mt-0.5 shrink-0">
                  {expanded === i ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm text-gray-800 truncate">{e.message}</span>
                  <span className="block text-xs text-gray-500 mt-0.5">
                    {formatTime(e.received_at)}
                    {e.url && <> · <span className="font-mono">{e.url}</span></>}
                    {e.source && <> · {e.source}</>}
                    {e.username && <> · {e.username}</>}
                  </span>
                </span>
              </button>

              {expanded === i && (
                <div className="px-3 pb-3 pl-9 space-y-2">
                  {e.stack && (
                    <pre className="text-[10px] text-gray-600 bg-gray-50 border border-gray-200 rounded p-2 overflow-auto max-h-64 whitespace-pre-wrap">
                      {e.stack}
                    </pre>
                  )}
                  {e.user_agent && (
                    <p className="text-[10px] text-gray-400 break-words">{e.user_agent}</p>
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};

export default ClientErrorsPanel;
