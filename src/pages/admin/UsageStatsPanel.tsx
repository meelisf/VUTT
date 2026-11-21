import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { BarChart3, RefreshCw } from 'lucide-react';
import { FILE_API_URL } from '../../config';
import { apiGet } from '../../services/apiClient';

interface UsageDay {
  date: string;
  requests: number;
  visitors: number;
  logged_in: number;
  page_loads: number;
  meili_queries: number;
  saves: number;
  polling: number;
  bot_requests: number;
  bot_ips: number;
  monitoring: number;
}

interface TopRow { id: string; n: number; label: string | null }

interface UsageData {
  days: UsageDay[];
  totals: Record<'requests' | 'page_loads' | 'meili_queries' | 'saves' | 'polling' | 'bot_requests' | 'monitoring', number>;
  daily: Record<'visitors' | 'logged_in' | 'bot_ips', { avg: number; max: number }>;
  tops: Record<'top_works' | 'top_persons' | 'referrers' | 'bots', TopRow[]>;
  first_date: string | null;
}

const PERIODS = [7, 30, 90, 365] as const;
const CHART_H = 100;

/** Kasutusstatistika nginxi logist (#855). Päevakokkuvõtted kirjutab hosti cron
 * (`scripts/usage_stats.py`); IP-sid failis ei ole. */
const UsageStatsPanel: React.FC<{ token?: string }> = ({ token }) => {
  const { t, i18n } = useTranslation(['admin', 'common']);
  const [period, setPeriod] = useState<number>(30);
  const [data, setData] = useState<UsageData | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [hover, setHover] = useState<number | null>(null);
  const locale = i18n.language === 'en' ? 'en-GB' : 'et-EE';
  const num = (n: number) => n.toLocaleString(locale, { maximumFractionDigits: 1 });
  const day = (iso: string) => {
    const [y, m, d] = iso.split('-').map(Number);
    return new Date(y, m - 1, d).toLocaleDateString(locale, { day: 'numeric', month: 'short' });
  };

  const load = useCallback(() => {
    setLoading(true);
    setLoadError(false);
    apiGet<UsageData>(`${FILE_API_URL}/admin/usage-stats?days=${period}`, { token })
      .then(setData)
      .catch(() => setLoadError(true))
      .finally(() => setLoading(false));
  }, [token, period]);

  useEffect(() => { load(); }, [load]);

  const days = data?.days ?? [];
  const maxVisitors = Math.max(1, ...days.map(d => d.visitors));
  const barW = days.length ? 100 / days.length : 0;
  const hovered = hover !== null ? days[hover] ?? null : null;

  const onMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const i = Math.floor(((e.clientX - rect.left) / rect.width) * days.length);
    setHover(i >= 0 && i < days.length ? i : null);
  };

  const topList = (title: string, rows: TopRow[], href?: (id: string) => string) => (
    <div>
      <div className="text-xs font-semibold text-gray-700 mb-1">{title}</div>
      {rows.length === 0 ? (
        <p className="text-xs text-gray-400">—</p>
      ) : (
        <ol className="text-xs text-gray-700 space-y-0.5">
          {rows.map(r => (
            <li key={r.id} className="flex justify-between gap-2">
              {href ? (
                <Link to={href(r.id)} className="truncate text-primary-700 hover:underline" title={r.label ?? r.id}>
                  {r.label ?? r.id}
                </Link>
              ) : (
                <span className="truncate" title={r.id}>{r.id}</span>
              )}
              <span className="tabular-nums text-gray-500 shrink-0">{num(r.n)}</span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );

  return (
    <div className="mb-6">
      <div className="flex items-center justify-between mb-3 gap-2">
        <h3 className="text-sm font-semibold text-gray-700 flex items-center gap-1.5">
          <BarChart3 size={15} className="text-gray-500" />
          {t('admin:usage.title')}
        </h3>
        <div className="flex items-center gap-2">
          <div className="flex rounded border border-gray-200 overflow-hidden text-xs">
            {PERIODS.map(p => (
              <button
                key={p}
                onClick={() => setPeriod(p)}
                className={`px-2 py-1 ${period === p ? 'bg-primary-600 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}
              >
                {t('admin:usage.periodDays', { count: p })}
              </button>
            ))}
          </div>
          <button
            onClick={load}
            disabled={loading}
            className="flex items-center gap-1 text-xs text-primary-600 hover:text-primary-800 border border-primary-200 rounded px-2 py-1 hover:bg-primary-50 disabled:opacity-50"
          >
            <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
            {t('common:refresh', 'Värskenda')}
          </button>
        </div>
      </div>

      <div className="bg-white border border-gray-200 rounded-lg p-4 space-y-4">
        {loadError && <p className="text-sm text-red-600">{t('admin:usage.loadFailed')}</p>}

        {data && days.length === 0 && <p className="text-sm text-gray-500">{t('admin:usage.empty')}</p>}

        {data && days.length > 0 && (
          <>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {[
                { label: t('admin:usage.visitorsPerDay'), value: num(data.daily.visitors.avg), sub: t('admin:usage.max', { n: data.daily.visitors.max }) },
                { label: t('admin:usage.loggedInPerDay'), value: num(data.daily.logged_in.avg), sub: t('admin:usage.max', { n: data.daily.logged_in.max }) },
                { label: t('admin:usage.pageLoads'), value: num(data.totals.page_loads), sub: t('admin:usage.meiliQueries', { n: num(data.totals.meili_queries) }) },
                { label: t('admin:usage.saves'), value: num(data.totals.saves), sub: t('admin:usage.botRequests', { n: num(data.totals.bot_requests) }) },
              ].map(s => (
                <div key={s.label}>
                  <div className="text-xs text-gray-500">{s.label}</div>
                  <div className="text-xl font-semibold text-gray-900 tabular-nums">{s.value}</div>
                  <div className="text-[11px] text-gray-400 tabular-nums">{s.sub}</div>
                </div>
              ))}
            </div>

            <div className="relative">
              <div className="text-xs text-gray-500 mb-1">
                {t('admin:usage.chartTitle')}
                <span className="ml-2 tabular-nums">max {num(maxVisitors)}</span>
              </div>
              <svg
                viewBox={`0 0 100 ${CHART_H}`}
                preserveAspectRatio="none"
                className="w-full h-[100px] block cursor-crosshair"
                onMouseMove={onMove}
                onMouseLeave={() => setHover(null)}
                role="img"
                aria-label={t('admin:usage.chartTitle')}
              >
                <line x1="0" x2="100" y1={CHART_H - 0.5} y2={CHART_H - 0.5} stroke="#e5e7eb" strokeWidth="1" vectorEffect="non-scaling-stroke" />
                {days.map((d, i) => {
                  const h = (d.visitors / maxVisitors) * (CHART_H - 4);
                  const hl = (Math.min(d.logged_in, d.visitors) / maxVisitors) * (CHART_H - 4);
                  return (
                    <g key={d.date}>
                      <rect x={i * barW + barW * 0.1} width={barW * 0.8} y={CHART_H - h} height={h}
                        className={hover === i ? 'fill-indigo-400' : 'fill-indigo-300'} />
                      <rect x={i * barW + barW * 0.1} width={barW * 0.8} y={CHART_H - hl} height={hl}
                        className={hover === i ? 'fill-indigo-800' : 'fill-indigo-600'} />
                    </g>
                  );
                })}
              </svg>
              <div className="flex justify-between text-[11px] text-gray-400 tabular-nums mt-1">
                <span>{day(days[0].date)}</span>
                <span>{day(days[days.length - 1].date)}</span>
              </div>
              {hovered && (
                <div
                  className="absolute top-6 z-10 pointer-events-none bg-gray-900 text-white text-xs rounded px-2 py-1.5 shadow tabular-nums whitespace-nowrap"
                  style={hover! / days.length > 0.6 ? { right: `${100 - (hover! / days.length) * 100}%` } : { left: `${(hover! / days.length) * 100}%` }}
                >
                  <div className="font-semibold">{day(hovered.date)}</div>
                  <div>{t('admin:usage.tipVisitors', { n: hovered.visitors })}</div>
                  <div>{t('admin:usage.tipLoggedIn', { n: hovered.logged_in })}</div>
                  <div>{t('admin:usage.tipPageLoads', { n: hovered.page_loads })}</div>
                  <div>{t('admin:usage.tipMeili', { n: hovered.meili_queries })}</div>
                  <div>{t('admin:usage.tipSaves', { n: hovered.saves })}</div>
                  <div className="text-gray-300">{t('admin:usage.tipBots', { n: hovered.bot_requests, ips: hovered.bot_ips })}</div>
                </div>
              )}
              <p className="text-xs text-gray-500 mt-2">{t('admin:usage.legend')}</p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {topList(t('admin:usage.topWorks'), data.tops.top_works, id => `/work/${id}`)}
              {topList(t('admin:usage.topPersons'), data.tops.top_persons, id => `/persons/${id}`)}
              {topList(t('admin:usage.referrers'), data.tops.referrers)}
              {topList(t('admin:usage.bots'), data.tops.bots)}
            </div>

            <p className="text-xs text-gray-500">
              {t('admin:usage.scopeNote')}
              {data.first_date && <> {t('admin:usage.since', { date: day(data.first_date) })}</>}
            </p>
          </>
        )}
      </div>
    </div>
  );
};

export default UsageStatsPanel;
