import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Activity, RefreshCw } from 'lucide-react';
import { FILE_API_URL } from '../../config';
import { apiGet } from '../../services/apiClient';
import { parseServerDate } from '../../utils/formatDateTime';
import { binMinutes, lastWindow, TrafficBin, TrafficMinute } from './trafficBins';

interface TrafficAlert {
  kind: 'load' | 'errors' | 'slow';
  at: string;
  requests: number;
  /** false = ükski kanal ei jõudnud kohale (server proovib uuesti). */
  delivered?: boolean;
  rps?: number;
  errors?: number;
  slow?: number;
  share?: number;
  max_ips_per_minute?: number;
}

interface TrafficData {
  minutes: TrafficMinute[];
  alerts: TrafficAlert[];
  thresholds: {
    rps: number; minutes: number; min_minutes: number;
    error_share: number; error_min: number;
    slow_share: number; slow_min: number; slow_seconds: number;
    cooldown_hours: number;
  };
}

const BIN_MINUTES = 10;
const CHART_H = 120;

/** Backendi liiklus 24 h + häirete ajalugu (#786). Ainult superadmin — häired
 * lähevad ainult talle. Mõõdab ainult backendi jõudnud päringuid: Meili ja
 * staatilised failid lähevad nginxist mööda. */
const TrafficPanel: React.FC<{ token?: string }> = ({ token }) => {
  const { t, i18n } = useTranslation(['admin', 'common']);
  const [data, setData] = useState<TrafficData | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [hover, setHover] = useState<number | null>(null);
  const locale = i18n.language === 'en' ? 'en-GB' : 'et-EE';

  const load = useCallback(() => {
    setLoading(true);
    setLoadError(false);
    apiGet<TrafficData>(`${FILE_API_URL}/admin/traffic`, { token })
      .then(setData)
      .catch(() => setLoadError(true))
      .finally(() => setLoading(false));
  }, [token]);

  useEffect(() => { load(); }, [load]);

  const bins = useMemo(() => binMinutes(data?.minutes ?? [], BIN_MINUTES), [data]);
  const recent = useMemo(() => lastWindow(data?.minutes ?? [], data?.thresholds.minutes ?? 10), [data]);
  const maxTotal = Math.max(1, ...bins.map(b => b.total));

  const time = (iso: string, withDate = false) => {
    try {
      const d = parseServerDate(iso);
      return withDate ? d.toLocaleString(locale) : d.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });
    } catch {
      return iso;
    }
  };

  const hovered: TrafficBin | null = hover !== null ? bins[hover] ?? null : null;
  const barW = bins.length ? 100 / bins.length : 0;

  const onMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const i = Math.floor(((e.clientX - rect.left) / rect.width) * bins.length);
    setHover(i >= 0 && i < bins.length ? i : null);
  };

  return (
    <div className="mb-6">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-gray-700 flex items-center gap-1.5">
          <Activity size={15} className="text-gray-500" />
          {t('admin:traffic.title')}
        </h3>
        <button
          onClick={load}
          disabled={loading}
          className="flex items-center gap-1 text-xs text-primary-600 hover:text-primary-800 border border-primary-200 rounded px-2 py-1 hover:bg-primary-50 disabled:opacity-50"
        >
          <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
          {t('common:refresh', 'Värskenda')}
        </button>
      </div>

      <div className="bg-white border border-gray-200 rounded-lg p-4 space-y-4">
        {loadError && <p className="text-sm text-red-600">{t('admin:traffic.loadFailed')}</p>}

        {data && (
          <>
            {/* Viimased täis minutid — sama aken, mida häire vaatab. */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {[
                { label: t('admin:traffic.rps'), value: recent.rps.toLocaleString(locale, { maximumFractionDigits: 1 }) },
                { label: t('admin:traffic.anonShare'), value: `${Math.round(recent.anonShare * 100)} %` },
                { label: t('admin:traffic.ipsPerMinute'), value: String(recent.maxIps) },
                { label: t('admin:traffic.errors'), value: String(recent.errors) },
              ].map(s => (
                <div key={s.label}>
                  <div className="text-xs text-gray-500">{s.label}</div>
                  <div className="text-xl font-semibold text-gray-900 tabular-nums">{s.value}</div>
                </div>
              ))}
            </div>
            <p className="text-xs text-gray-500">{t('admin:traffic.windowNote', { minutes: data.thresholds.minutes })}</p>

            {bins.length === 0 ? (
              <p className="text-sm text-gray-500">{t('admin:traffic.empty')}</p>
            ) : (
              <div className="relative">
                <div className="text-xs text-gray-500 mb-1">
                  {t('admin:traffic.chartTitle', { minutes: BIN_MINUTES })}
                  <span className="ml-2 tabular-nums">max {maxTotal.toLocaleString(locale)}</span>
                </div>
                <svg
                  viewBox={`0 0 100 ${CHART_H}`}
                  preserveAspectRatio="none"
                  className="w-full h-[120px] block cursor-crosshair"
                  onMouseMove={onMove}
                  onMouseLeave={() => setHover(null)}
                  role="img"
                  aria-label={t('admin:traffic.chartTitle', { minutes: BIN_MINUTES })}
                >
                  <line x1="0" x2="100" y1={CHART_H - 0.5} y2={CHART_H - 0.5} stroke="#e5e7eb" strokeWidth="1" vectorEffect="non-scaling-stroke" />
                  {bins.map((b, i) => {
                    const h = (b.total / maxTotal) * (CHART_H - 4);
                    return (
                      <rect
                        key={b.start}
                        x={i * barW + barW * 0.1}
                        width={barW * 0.8}
                        y={CHART_H - h}
                        height={h}
                        className={b.errors > 0 ? 'fill-amber-500' : hover === i ? 'fill-indigo-700' : 'fill-indigo-500'}
                      />
                    );
                  })}
                </svg>
                <div className="flex justify-between text-[11px] text-gray-400 tabular-nums mt-1">
                  <span>{time(bins[0].start)}</span>
                  <span>{time(bins[bins.length - 1].start)}</span>
                </div>
                {hovered && (
                  <div
                    className="absolute top-6 z-10 pointer-events-none bg-gray-900 text-white text-xs rounded px-2 py-1.5 shadow tabular-nums whitespace-nowrap"
                    style={hover! / bins.length > 0.6 ? { right: `${100 - (hover! / bins.length) * 100}%` } : { left: `${(hover! / bins.length) * 100}%` }}
                  >
                    <div className="font-semibold">{time(hovered.start, true)}</div>
                    <div>{t('admin:traffic.tipTotal', { n: hovered.total })}</div>
                    <div>{t('admin:traffic.tipAnon', { n: hovered.anon })}</div>
                    <div>{t('admin:traffic.tipIps', { n: hovered.maxIps })}</div>
                    {hovered.errors > 0 && <div className="text-amber-300">{t('admin:traffic.tipErrors', { n: hovered.errors })}</div>}
                    {hovered.slow > 0 && <div>{t('admin:traffic.tipSlow', { n: hovered.slow })}</div>}
                  </div>
                )}
                <p className="text-xs text-gray-500 mt-2">{t('admin:traffic.legendErrors')}</p>
              </div>
            )}

            <p className="text-xs text-gray-500">
              {t('admin:traffic.thresholds', {
                rps: data.thresholds.rps,
                minMinutes: data.thresholds.min_minutes,
                minutes: data.thresholds.minutes,
                share: Math.round(data.thresholds.error_share * 100),
                min: data.thresholds.error_min,
                slowShare: Math.round(data.thresholds.slow_share * 100),
                slowMin: data.thresholds.slow_min,
                slowSeconds: data.thresholds.slow_seconds,
                hours: data.thresholds.cooldown_hours,
              })}
              {' '}{t('admin:traffic.scopeNote')}
            </p>

            <div>
              <div className="text-xs font-semibold text-gray-700 mb-1">{t('admin:traffic.alertsTitle')}</div>
              {data.alerts.length === 0 ? (
                <p className="text-xs text-gray-500">{t('admin:traffic.noAlerts')}</p>
              ) : (
                <ul className="text-xs text-gray-700 space-y-0.5">
                  {data.alerts.map(a => (
                    <li key={`${a.kind}-${a.at}`} className="tabular-nums">
                      <span className="text-gray-500">{time(a.at, true)}</span>{' · '}
                      {a.kind === 'load'
                        ? t('admin:traffic.alertLoad', { rps: a.rps, ips: a.max_ips_per_minute })
                        : a.kind === 'slow'
                          ? t('admin:traffic.alertSlow', { slow: a.slow, share: ((a.share ?? 0) * 100).toFixed(1) })
                          : t('admin:traffic.alertErrors', { errors: a.errors, share: ((a.share ?? 0) * 100).toFixed(1) })}
                      {a.delivered === false && <span className="ml-1 text-red-600">({t('admin:traffic.notDelivered')})</span>}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
};

export default TrafficPanel;
