import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { BarChart3, PieChart as PieChartIcon, BookOpen, FileText, Loader2 } from 'lucide-react';
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid } from 'recharts';
import Header from '../components/Header';
import { MEILI_HOST, MEILI_API_KEY } from '../config';

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
  const { t } = useTranslation(['statistics', 'common']);

  const [isLoading, setIsLoading] = useState(true);
  const [totalPages, setTotalPages] = useState(0);
  const [totalWorks, setTotalWorks] = useState(0);
  const [statusData, setStatusData] = useState<StatusCount[]>([]);
  const [yearData, setYearData] = useState<YearCount[]>([]);

  useEffect(() => {
    const fetchStats = async () => {
      setIsLoading(true);
      try {
        // Fetch status facets
        const headers: Record<string, string> = {
          'Content-Type': 'application/json'
        };
        if (MEILI_API_KEY) {
          headers['Authorization'] = `Bearer ${MEILI_API_KEY}`;
        }

        const statusResponse = await fetch(`${MEILI_HOST}/indexes/teosed/search`, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            q: '',
            limit: 0,
            facets: ['teose_staatus', 'aasta', 'teose_id']
          })
        });

        const statusResult = await statusResponse.json();

        // Status breakdown
        const statusFacets = statusResult.facetDistribution?.teose_staatus || {};

        // Total pages - arvutame facetide summast (täpsem kui estimatedTotalHits)
        const totalFromFacets = Object.values(statusFacets).reduce((sum: number, val) => sum + (val as number), 0);
        setTotalPages(totalFromFacets || statusResult.estimatedTotalHits || 0);
        const statusColors: Record<string, string> = {
          'Valmis': '#16a34a',
          'Töös': '#ca8a04',
          'Toores': '#9ca3af'
        };

        const statusArray: StatusCount[] = Object.entries(statusFacets).map(([name, value]) => ({
          name,
          value: value as number,
          color: statusColors[name] || '#6b7280'
        }));
        setStatusData(statusArray);

        // Year distribution
        const yearFacets = statusResult.facetDistribution?.aasta || {};
        const yearArray: YearCount[] = Object.entries(yearFacets)
          .map(([year, count]) => ({ year: parseInt(year), count: count as number }))
          .filter(y => y.year > 1600 && y.year < 1800)
          .sort((a, b) => a.year - b.year);
        setYearData(yearArray);

        // Works count - unikaalsete teose_id-de arv facetist
        const worksFacets = statusResult.facetDistribution?.teose_id || {};
        setTotalWorks(Object.keys(worksFacets).length);

      } catch (error) {
        console.error('Statistics fetch error:', error);
      } finally {
        setIsLoading(false);
      }
    };

    fetchStats();
  }, []);

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
        showSearchButton={false} 
        pageTitle={t('header.title')} 
        pageTitleIcon={<BarChart3 className="text-primary-600" size={22} />} 
      />

      <div className="max-w-7xl mx-auto px-8 py-8 space-y-6">

        {/* KPI Cards */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
            <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-200">
                <h3 className="text-sm font-medium text-gray-500 uppercase tracking-wide flex items-center gap-2">
                  <BookOpen size={16} />
                  {t('kpi.totalWorks')}
                </h3>
                <p className="text-3xl font-bold text-gray-900 mt-2">{totalWorks.toLocaleString()}</p>
            </div>
            <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-200">
                <h3 className="text-sm font-medium text-gray-500 uppercase tracking-wide flex items-center gap-2">
                  <FileText size={16} />
                  {t('kpi.totalVolume')}
                </h3>
                <p className="text-3xl font-bold text-gray-900 mt-2">{totalPages.toLocaleString()} <span className="text-lg text-gray-400 font-normal">{t('kpi.pages')}</span></p>
            </div>
            <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-200">
                <h3 className="text-sm font-medium text-gray-500 uppercase tracking-wide">{t('kpi.readiness')}</h3>
                <p className="text-3xl font-bold text-green-600 mt-2">{progressPercentage}%</p>
            </div>
            <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-200">
                <h3 className="text-sm font-medium text-gray-500 uppercase tracking-wide">{t('kpi.avgPages')}</h3>
                <p className="text-3xl font-bold text-primary-600 mt-2">
                  {totalWorks > 0 ? Math.round(totalPages / totalWorks) : 0}
                  <span className="text-lg text-gray-400 font-normal"> {t('kpi.perWork')}</span>
                </p>
            </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Status Chart */}
            <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-200 flex flex-col min-h-[400px]">
                <h2 className="text-lg font-bold text-gray-800 mb-6 flex items-center gap-2">
                    <PieChartIcon size={20} className="text-gray-400"/>
                    {t('charts.pageStatus')}
                </h2>
                {statusData.length > 0 ? (
                  <>
                    <div className="flex-1">
                        <ResponsiveContainer width="100%" height="100%">
                        <PieChart>
                            <Pie
                            data={statusData}
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
                            <Tooltip contentStyle={{borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)'}} />
                        </PieChart>
                        </ResponsiveContainer>
                    </div>
                    <div className="flex justify-center gap-4 text-xs font-bold text-gray-500 mt-4 flex-wrap">
                        {statusData.map(item => (
                        <div key={item.name} className="flex items-center gap-2 bg-gray-50 px-3 py-1.5 rounded-full border border-gray-100">
                            <span className="w-3 h-3 rounded-full" style={{backgroundColor: item.color}}></span>
                            {t(`common:status.${item.name}`)}: {item.value.toLocaleString()}
                        </div>
                        ))}
                    </div>
                  </>
                ) : (
                  <div className="flex-1 flex items-center justify-center text-gray-400">
                    {t('common:labels.noData')}
                  </div>
                )}
            </div>

            {/* Year Distribution Chart */}
            <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-200 flex flex-col min-h-[400px]">
                <h2 className="text-lg font-bold text-gray-800 mb-6 flex items-center gap-2">
                    <BarChart3 size={20} className="text-gray-400"/>
                    {t('charts.byYear')}
                </h2>
                {yearData.length > 0 ? (
                  <>
                    <div className="flex-1">
                        <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={yearData} margin={{ top: 20, right: 30, left: 0, bottom: 5 }}>
                            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f3f4f6" />
                            <XAxis
                              dataKey="year"
                              axisLine={false}
                              tickLine={false}
                              tick={{fontSize: 11, fill: '#6b7280'}}
                              interval={Math.floor(yearData.length / 10)}
                            />
                            <YAxis axisLine={false} tickLine={false} fontSize={12} tick={{fontSize: 12, fill: '#9ca3af'}} />
                            <Tooltip
                              cursor={{fill: '#f0f9ff'}}
                              contentStyle={{borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)'}}
                              formatter={(value: number) => [value.toLocaleString(), t('kpi.pages')]}
                            />
                            <Bar dataKey="count" fill="#0284c7" radius={[4, 4, 0, 0]} />
                        </BarChart>
                        </ResponsiveContainer>
                    </div>
                    <p className="text-center text-sm text-gray-500 mt-4">{t('charts.pagesByYear')}</p>
                  </>
                ) : (
                  <div className="flex-1 flex items-center justify-center text-gray-400">
                    {t('common:labels.noData')}
                  </div>
                )}
            </div>
        </div>
      </div>
    </div>
  );
};

export default Statistics;
