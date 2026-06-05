import React, { useState, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useCollectionUrlSync } from '../hooks/useCollectionUrlSync';
import { BarChart3, PieChart as PieChartIcon, BookOpen, FileText, Loader2, Library, Tag, Link2, Check } from 'lucide-react';
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid } from 'recharts';
import Header from '../components/Header';
import { MEILI_HOST, MEILI_API_KEY } from '../config';
import { useCollection } from '../contexts/CollectionContext';
import { useMeiliIndex } from '../contexts/MeilisearchContext';
import { getCollectionColorClasses } from '../services/collectionService';
import { fetchWithTimeout } from '../utils/fetchWithTimeout';
import { getLangCode } from '../utils/getLangCode';
import { getGenreFacets, getGenreLabelMap } from '../services/searchService';

interface StatusCount {
  name: string;
  value: number;
  color: string;
}

interface YearCount {
  year: number;
  count: number;
}

const Statistics: React.FC = () => {
  const { t, i18n } = useTranslation(['statistics', 'common']);
  const { selectedCollection, setSelectedCollection, getCollectionName, collections } = useCollection();
  const index = useMeiliIndex();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  // Sünkroonib kollektsiooni URL ?collection= parameetriga (mõlemas suunas)
  useCollectionUrlSync(selectedCollection, setSearchParams);
  useEffect(() => {
    const collectionParam = searchParams.get('collection');
    if (collectionParam && collections[collectionParam] && collectionParam !== selectedCollection) {
      setSelectedCollection(collectionParam);
    }
  }, [searchParams.get('collection'), collections]);
  const lang = getLangCode(i18n.language);
  const [collectionLinkCopied, setCollectionLinkCopied] = useState(false);

  const [isLoading, setIsLoading] = useState(true);
  const [isTimelineLoading, setIsTimelineLoading] = useState(false);
  const [totalPages, setTotalPages] = useState(0);
  const [totalWorks, setTotalWorks] = useState(0);
  const [statusData, setStatusData] = useState<StatusCount[]>([]);

  // Žanrifilter
  const [genres, setGenres] = useState<{ value: string; count: number }[]>([]);
  const [genreLabelMap, setGenreLabelMap] = useState<Record<string, string>>({});
  const [selectedGenre, setSelectedGenre] = useState<string | null>(null);

  // Globaalne aasta vahemik — kogu projekt, laetakse üks kord
  const [globalMinYear, setGlobalMinYear] = useState(0);
  const [globalMaxYear, setGlobalMaxYear] = useState(0);

  // Ajajoon — täidetud tühjade aastatega (globalMin..globalMax)
  const [worksYearData, setWorksYearData] = useState<YearCount[]>([]);

  // Slaiduri valik (tegelikud aastad)
  const [yearFrom, setYearFrom] = useState(0);
  const [yearTo, setYearTo] = useState(0);
  const [yearFromInput, setYearFromInput] = useState('');
  const [yearToInput, setYearToInput] = useState('');

  const meiliHeaders = useMemo<Record<string, string>>(() => {
    const h: Record<string, string> = { 'Content-Type': 'application/json' };
    if (MEILI_API_KEY) h['Authorization'] = `Bearer ${MEILI_API_KEY}`;
    return h;
  }, []);

  // KPI + staatuse päring (kollektsioon + žanr)
  useEffect(() => {
    const fetchStats = async () => {
      setIsLoading(true);
      try {
        const filter: string[] = [];
        if (selectedCollection) filter.push(`collections_hierarchy = "${selectedCollection}"`);
        if (selectedGenre) filter.push(`genre_ids = "${selectedGenre}"`);

        const statusResponse = await fetchWithTimeout(`${MEILI_HOST}/indexes/teosed/search`, {
          method: 'POST',
          headers: meiliHeaders,
          body: JSON.stringify({
            q: '',
            limit: 0,
            facets: ['status', 'work_id'],
            filter: filter.length > 0 ? filter : undefined
          })
        });
        const statusResult = await statusResponse.json();

        const statusFacets = statusResult.facetDistribution?.status || {};
        const totalFromFacets = Object.values(statusFacets).reduce((sum: number, val) => sum + (val as number), 0);
        setTotalPages(totalFromFacets || statusResult.estimatedTotalHits || 0);

        const statusColors: Record<string, string> = {
          'Valmis': '#16a34a',
          'Töös': '#ca8a04',
          'Toores': '#9ca3af'
        };
        setStatusData(
          Object.entries(statusFacets).map(([name, value]) => ({
            name,
            value: value as number,
            color: statusColors[name] || '#6b7280'
          }))
        );

        const worksFacets = statusResult.facetDistribution?.work_id || {};
        setTotalWorks(Object.keys(worksFacets).length);
      } catch (error) {
        console.error('Statistics fetch error:', error);
      } finally {
        setIsLoading(false);
      }
    };

    fetchStats();
  }, [selectedCollection, selectedGenre, lang, meiliHeaders]);

  // Žanride päring
  useEffect(() => {
    if (!index) return;
    const fetchGenres = async () => {
      const [result, labelMap] = await Promise.all([
        getGenreFacets(index, selectedCollection || undefined, lang),
        getGenreLabelMap(index, selectedCollection || undefined, lang),
      ]);
      setGenres(result);
      setGenreLabelMap(labelMap);
      if (selectedGenre && !result.find(g => g.value === selectedGenre)) {
        setSelectedGenre(null);
      }
    };
    fetchGenres();
  }, [selectedCollection, lang, index]);

  // Ajajoone päring — vahemik ja andmed järjestikku (väldib race condition'it)
  useEffect(() => {
    const fetchTimeline = async () => {
      setIsTimelineLoading(true);
      try {
        const collectionFilter = selectedCollection
          ? `collections_hierarchy = "${selectedCollection}"`
          : null;

        // Samm 1: kollektsiooni aasta vahemik (žanrita — annab täpse min/max)
        const rangeFilter = ['lehekylje_number = 1'];
        if (collectionFilter) rangeFilter.push(collectionFilter);

        const rangeResponse = await fetchWithTimeout(`${MEILI_HOST}/indexes/teosed/search`, {
          method: 'POST',
          headers: meiliHeaders,
          body: JSON.stringify({ q: '', limit: 0, facets: ['year'], filter: rangeFilter })
        });
        const rangeResult = await rangeResponse.json();
        const rangeYears = Object.keys(rangeResult.facetDistribution?.year || {})
          .map(Number).filter(y => y > 1400 && y < 1900);

        if (rangeYears.length === 0) {
          setWorksYearData([]);
          setIsTimelineLoading(false);
          return;
        }

        const gMin = Math.min(...rangeYears);
        const gMax = Math.max(...rangeYears);
        setGlobalMinYear(gMin);
        setGlobalMaxYear(gMax);
        setYearFrom(gMin);
        setYearTo(gMax);
        setYearFromInput(String(gMin));
        setYearToInput(String(gMax));

        // Samm 2: andmed sama vahemiku jaoks (nüüd ka žanrifiltriga)
        const dataFilter = ['lehekylje_number = 1'];
        if (collectionFilter) dataFilter.push(collectionFilter);
        if (selectedGenre) dataFilter.push(`genre_ids = "${selectedGenre}"`);

        const dataResponse = await fetchWithTimeout(`${MEILI_HOST}/indexes/teosed/search`, {
          method: 'POST',
          headers: meiliHeaders,
          body: JSON.stringify({ q: '', limit: 0, facets: ['year'], filter: dataFilter })
        });
        const dataResult = await dataResponse.json();

        const rawData: YearCount[] = Object.entries(dataResult.facetDistribution?.year || {})
          .map(([year, count]) => ({ year: parseInt(year), count: count as number }))
          .filter(y => y.year > 1400 && y.year < 1900);

        // Täida tühjad aastad nullidega — vahemik teada eelmisest päringust
        const filled: YearCount[] = [];
        for (let y = gMin; y <= gMax; y++) {
          filled.push({ year: y, count: rawData.find(d => d.year === y)?.count || 0 });
        }
        setWorksYearData(filled);
      } catch (error) {
        console.error('Timeline fetch error:', error);
      } finally {
        setIsTimelineLoading(false);
      }
    };

    fetchTimeline();
  }, [selectedCollection, selectedGenre, lang, meiliHeaders]);

  // Kuvatav alamhulk (slaiduri vahemik)
  const displayedData = useMemo(
    () => worksYearData.filter(d => d.year >= yearFrom && d.year <= yearTo),
    [worksYearData, yearFrom, yearTo]
  );

  // Mobiilituvastus — graafikute kohandamiseks
  const [isMobile, setIsMobile] = useState(() => typeof window !== 'undefined' && window.innerWidth < 640);
  useEffect(() => {
    const handler = () => setIsMobile(window.innerWidth < 640);
    window.addEventListener('resize', handler);
    return () => window.removeEventListener('resize', handler);
  }, []);

  // Slaiduri protsendid teerajoonele
  const range = Math.max(1, globalMaxYear - globalMinYear);
  const fromPct = ((yearFrom - globalMinYear) / range) * 100;
  const toPct = ((yearTo - globalMinYear) / range) * 100;

  // Numbrivälja muutus → yearFrom/yearTo uuendus
  const handleYearFromInput = (val: string) => {
    setYearFromInput(val);
    const year = parseInt(val);
    if (!isNaN(year) && year >= globalMinYear && year < yearTo) {
      setYearFrom(year);
    }
  };

  const handleYearToInput = (val: string) => {
    setYearToInput(val);
    const year = parseInt(val);
    if (!isNaN(year) && year <= globalMaxYear && year > yearFrom) {
      setYearTo(year);
    }
  };

  // Slaiduri muutus → numbriväljade uuendus
  const handleFromSlider = (val: number) => {
    const v = Math.min(val, yearTo - 1);
    setYearFrom(v);
    setYearFromInput(String(v));
  };

  const handleToSlider = (val: number) => {
    const v = Math.max(val, yearFrom + 1);
    setYearTo(v);
    setYearToInput(String(v));
  };

  // Tulba klikk → Dashboard, kus vastav aasta ja žanr valitud
  const handleBarClick = (data: YearCount) => {
    const params = new URLSearchParams();
    params.set('ys', String(data.year));
    params.set('ye', String(data.year));
    if (selectedGenre) params.set('genre', selectedGenre);
    navigate(`/?${params.toString()}`);
  };

  const completedPages = statusData.find(d => d.name === 'Valmis')?.value || 0;
  const progressPercentage = totalPages > 0 ? Math.round((completedPages / totalPages) * 100) : 0;

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <Loader2 className="animate-spin text-primary-600" size={48} />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 font-sans">
      <Header
        pageTitle={t('header.title')}
        pageTitleIcon={<BarChart3 className="text-primary-600" size={22} />}
      />

      <div className="max-w-7xl mx-auto px-4 py-4 sm:px-8 sm:py-8 space-y-3 sm:space-y-6">

        {/* Kollektsiooni filter indikaator */}
        {selectedCollection && (() => {
          const colorClasses = getCollectionColorClasses(collections[selectedCollection]);
          return (
            <div className={`${colorClasses.bg} border ${colorClasses.border} rounded-lg p-3 sm:p-4 flex items-center justify-between gap-3`}>
              <div className="flex items-center gap-3">
                <Library className={colorClasses.text} size={20} />
                <div>
                  <span className={`text-sm ${colorClasses.text}`}>{t('common:collections.activeFilter')}:</span>
                  <span className={`ml-2 font-bold ${colorClasses.text}`}>{getCollectionName(selectedCollection, lang)}</span>
                </div>
              </div>
              <button
                onClick={async () => {
                  const url = `${window.location.origin}/stats?collection=${encodeURIComponent(selectedCollection)}`;
                  try { await navigator.clipboard.writeText(url); } catch {
                    const el = document.createElement('textarea');
                    el.value = url; document.body.appendChild(el); el.select();
                    document.execCommand('copy'); document.body.removeChild(el);
                  }
                  setCollectionLinkCopied(true);
                  setTimeout(() => setCollectionLinkCopied(false), 2000);
                }}
                className={`inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded border ${colorClasses.border} ${colorClasses.hoverBg} ${colorClasses.text} transition-colors shrink-0`}
                title={t('common:collections.copyLink', 'Kopeeri link')}
              >
                {collectionLinkCopied ? <Check size={13} /> : <Link2 size={13} />}
                <span className="hidden sm:inline">{collectionLinkCopied ? t('common:collections.linkCopied', 'Kopeeritud!') : t('common:collections.copyLink', 'Kopeeri link')}</span>
              </button>
            </div>
          );
        })()}

        {/* KPI kaardid */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 sm:gap-6">
          <div className="bg-white p-3 sm:p-6 rounded-xl shadow-sm border border-gray-200">
            <h3 className="text-xs sm:text-sm font-medium text-gray-500 uppercase tracking-wide flex items-center gap-2">
              <BookOpen size={14} className="shrink-0" />
              {t('kpi.totalWorks')}
            </h3>
            <p className="text-2xl sm:text-3xl font-bold text-gray-900 mt-2">{totalWorks.toLocaleString()}</p>
          </div>
          <div className="bg-white p-3 sm:p-6 rounded-xl shadow-sm border border-gray-200">
            <h3 className="text-xs sm:text-sm font-medium text-gray-500 uppercase tracking-wide flex items-center gap-2">
              <FileText size={14} className="shrink-0" />
              {t('kpi.totalVolume')}
            </h3>
            <p className="text-2xl sm:text-3xl font-bold text-gray-900 mt-2">{totalPages.toLocaleString()} <span className="text-base sm:text-lg text-gray-400 font-normal">{t('kpi.pages')}</span></p>
          </div>
          <div className="bg-white p-3 sm:p-6 rounded-xl shadow-sm border border-gray-200">
            <h3 className="text-xs sm:text-sm font-medium text-gray-500 uppercase tracking-wide">{t('kpi.readiness')}</h3>
            <p className="text-2xl sm:text-3xl font-bold text-green-600 mt-2">{progressPercentage}%</p>
          </div>
          <div className="bg-white p-3 sm:p-6 rounded-xl shadow-sm border border-gray-200">
            <h3 className="text-xs sm:text-sm font-medium text-gray-500 uppercase tracking-wide">{t('kpi.avgPages')}</h3>
            <p className="text-2xl sm:text-3xl font-bold text-primary-600 mt-2">
              {totalWorks > 0 ? Math.round(totalPages / totalWorks) : 0}
              <span className="text-base sm:text-lg text-gray-400 font-normal"> {t('kpi.perWork')}</span>
            </p>
          </div>
        </div>

        {/* Žanrifilter */}
        <div className="bg-white p-3 sm:p-4 rounded-xl shadow-sm border border-gray-200 flex items-start gap-3 sm:gap-4">
          <div className="flex items-center gap-2 text-gray-500 shrink-0 pt-1">
            <Tag size={16} />
            <span className="text-sm font-medium">{t('genre.label')}:</span>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => setSelectedGenre(null)}
              className={`px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${
                selectedGenre === null
                  ? 'bg-primary-600 text-white'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              {t('genre.allGenres')}
            </button>
            {genres.map(g => (
              <button
                key={g.value}
                onClick={() => setSelectedGenre(selectedGenre === g.value ? null : g.value)}
                className={`px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${
                  selectedGenre === g.value
                    ? 'bg-primary-600 text-white'
                    : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                }`}
              >
                {genreLabelMap[g.value] || g.value} <span className="opacity-60">({g.count})</span>
              </button>
            ))}
          </div>
        </div>

        {/* Teosed aastate kaupa — täislaiuslik graafik */}
        <div className="bg-white p-3 sm:p-6 rounded-xl shadow-sm border border-gray-200">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between mb-4">
            <h2 className="text-lg font-bold text-gray-800 flex items-center gap-2">
              <BarChart3 size={20} className="text-gray-400" />
              {t('charts.worksByYear')}
              {selectedGenre && (
                <span className="text-primary-600 font-normal text-base ml-1">— {genreLabelMap[selectedGenre] || selectedGenre}</span>
              )}
            </h2>
            {/* Täpne aasta sisestus */}
            <div className="flex items-center gap-2 text-sm text-gray-500">
              <span>{t('charts.yearFrom')}</span>
              <input
                type="number"
                value={yearFromInput}
                onChange={e => handleYearFromInput(e.target.value)}
                onBlur={() => setYearFromInput(String(yearFrom))}
                className="w-20 px-2 py-1 border border-gray-300 rounded text-sm text-center focus:outline-none focus:ring-1 focus:ring-primary-500"
              />
              <span>{t('charts.yearTo')}</span>
              <input
                type="number"
                value={yearToInput}
                onChange={e => handleYearToInput(e.target.value)}
                onBlur={() => setYearToInput(String(yearTo))}
                className="w-20 px-2 py-1 border border-gray-300 rounded text-sm text-center focus:outline-none focus:ring-1 focus:ring-primary-500"
              />
            </div>
          </div>

          {isTimelineLoading ? (
            <div className="h-64 flex items-center justify-center">
              <Loader2 className="animate-spin text-gray-400" size={32} />
            </div>
          ) : displayedData.length > 0 ? (
            <div className="h-52 sm:h-72">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={displayedData}
                  margin={isMobile
                    ? { top: 5, right: 5, left: -25, bottom: 0 }
                    : { top: 10, right: 10, left: 0, bottom: 5 }
                  }
                >
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f3f4f6" />
                  <XAxis
                    dataKey="year"
                    axisLine={false}
                    tickLine={false}
                    tick={{ fontSize: isMobile ? 10 : 11, fill: '#6b7280' }}
                    interval={Math.max(0, Math.floor(displayedData.length / (isMobile ? 6 : 12)))}
                  />
                  <YAxis
                    hide={isMobile}
                    axisLine={false}
                    tickLine={false}
                    tick={{ fontSize: 12, fill: '#9ca3af' }}
                    allowDecimals={false}
                  />
                  <Tooltip
                    cursor={{ fill: '#f0f9ff' }}
                    contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)', fontSize: isMobile ? 12 : 14 }}
                    formatter={(value: number) => [value.toLocaleString(), t('charts.works')]}
                    labelFormatter={(label) => String(label)}
                  />
                  <Bar
                    dataKey="count"
                    fill="#0284c7"
                    radius={[3, 3, 0, 0]}
                    maxBarSize={40}
                    cursor="pointer"
                    onClick={(data) => { const d = data as unknown as YearCount; if (d.count > 0) handleBarClick(d); }}
                  />
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <div className="h-64 flex items-center justify-center text-gray-400">
              {t('common:labels.noData')}
            </div>
          )}

          {/* Dual range slider */}
          {globalMinYear > 0 && (
            <div className="px-2 mt-5 mb-1">
              {/* Teerajoon + käepidemed */}
              <div className="relative" style={{ height: '20px' }}>
                {/* Teerajoon taust */}
                <div className="absolute inset-x-0 top-1/2 -translate-y-1/2 h-1.5 bg-gray-200 rounded-full" />
                {/* Valitud vahemiku esiletõstus */}
                <div
                  className="absolute top-1/2 -translate-y-1/2 h-1.5 bg-primary-400 rounded-full"
                  style={{ left: `${fromPct}%`, right: `${100 - toPct}%` }}
                />
                {/* Alguse käepide */}
                <input
                  type="range"
                  className="dual-range-input"
                  min={globalMinYear}
                  max={globalMaxYear}
                  value={yearFrom}
                  onChange={e => handleFromSlider(parseInt(e.target.value))}
                />
                {/* Lõpu käepide */}
                <input
                  type="range"
                  className="dual-range-input"
                  min={globalMinYear}
                  max={globalMaxYear}
                  value={yearTo}
                  onChange={e => handleToSlider(parseInt(e.target.value))}
                />
              </div>
              {/* Siltid + lähtesta nupp */}
              <div className="flex justify-between items-center text-xs mt-2">
                <span className="text-gray-400">{globalMinYear}</span>
                <div className="flex items-center gap-3">
                  <span className="text-primary-600 font-medium">{yearFrom} – {yearTo}</span>
                  {(yearFrom !== globalMinYear || yearTo !== globalMaxYear) && (
                    <button
                      onClick={() => {
                        setYearFrom(globalMinYear);
                        setYearTo(globalMaxYear);
                        setYearFromInput(String(globalMinYear));
                        setYearToInput(String(globalMaxYear));
                      }}
                      className="text-gray-400 hover:text-gray-600 underline transition-colors"
                    >
                      {t('charts.resetRange')}
                    </button>
                  )}
                </div>
                <span className="text-gray-400">{globalMaxYear}</span>
              </div>
            </div>
          )}

          <p className="text-center text-sm text-gray-500 mt-3">{t('charts.worksByYearSub')}</p>
        </div>

        {/* Staatuse pirdiagramm */}
        <div className="bg-white p-3 sm:p-6 rounded-xl shadow-sm border border-gray-200">
          <h2 className="text-lg font-bold text-gray-800 mb-6 flex items-center gap-2 flex-wrap">
            <PieChartIcon size={20} className="text-gray-400 shrink-0" />
            {selectedCollection
              ? t('charts.pageStatusInCollection', { collection: getCollectionName(selectedCollection, lang) })
              : t('charts.pageStatus')}
            {selectedGenre && (
              <span className="px-2.5 py-0.5 bg-primary-100 text-primary-700 text-sm font-medium rounded-full">
                {genreLabelMap[selectedGenre] || selectedGenre}
              </span>
            )}
          </h2>
          {statusData.length > 0 ? (
            <>
              <ResponsiveContainer width="100%" height={300}>
                  <PieChart>
                    <Pie
                      data={statusData as { name: string; value: number }[]}
                      cx="50%"
                      cy="50%"
                      innerRadius={80}
                      outerRadius={120}
                      paddingAngle={5}
                      dataKey="value"
                      label={({ name, percent }) => `${t(`common:status.${name}`)} ${(percent * 100).toFixed(0)}%`}
                    >
                      {statusData.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={entry.color} />
                      ))}
                    </Pie>
                    <Tooltip contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }} />
                  </PieChart>
              </ResponsiveContainer>
              <div className="flex justify-center gap-4 text-xs font-bold text-gray-500 mt-4 flex-wrap">
                {statusData.map(item => (
                  <div key={item.name} className="flex items-center gap-2 bg-gray-50 px-3 py-1.5 rounded-full border border-gray-100">
                    <span className="w-3 h-3 rounded-full" style={{ backgroundColor: item.color }}></span>
                    {t(`common:status.${item.name}`)}: {item.value.toLocaleString()} {t('kpi.pages')}
                  </div>
                ))}
              </div>
            </>
          ) : (
            <div className="h-48 flex items-center justify-center text-gray-400">
              {t('common:labels.noData')}
            </div>
          )}
        </div>

      </div>
    </div>
  );
};

export default Statistics;
