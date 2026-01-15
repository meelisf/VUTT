import React from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, BarChart3, PieChart as PieChartIcon } from 'lucide-react';
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid } from 'recharts';
import LanguageSwitcher from '../components/LanguageSwitcher';

const Statistics: React.FC = () => {
  const { t } = useTranslation(['statistics', 'common']);
  const navigate = useNavigate();

  // Mock data for charts
  const statusData = [
    { name: 'Valmis', value: 1240, color: '#16a34a' }, // Green
    { name: 'Parandatud', value: 3400, color: '#2563eb' }, // Blue
    { name: 'Töös', value: 2100, color: '#ca8a04' }, // Yellow
    { name: 'Toores', value: 7260, color: '#9ca3af' }, // Gray
  ];

  const activityData = [
    { name: t('days.mon'), pages: 45 },
    { name: t('days.tue'), pages: 72 },
    { name: t('days.wed'), pages: 58 },
    { name: t('days.thu'), pages: 90 },
    { name: t('days.fri'), pages: 34 },
    { name: t('days.sat'), pages: 12 },
    { name: t('days.sun'), pages: 5 },
  ];

  const totalPages = statusData.reduce((acc, curr) => acc + curr.value, 0);
  const completedPages = statusData.find(d => d.name === 'Valmis')?.value || 0;
  const progressPercentage = Math.round((completedPages / totalPages) * 100);

  return (
    <div className="min-h-screen bg-gray-50 font-sans">
      {/* Header */}
      <div className="bg-white border-b border-gray-200 px-8 py-4 shadow-sm sticky top-0 z-10">
        <div className="flex justify-between items-start">
          <div>
            <button
                onClick={() => navigate('/')}
                className="flex items-center gap-2 text-gray-600 hover:text-gray-900 transition-colors mb-2"
            >
                <ArrowLeft size={18} />
                <span className="font-medium">{t('header.backToHome')}</span>
            </button>
            <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
                <BarChart3 className="text-primary-600" />
                {t('header.title')}
            </h1>
          </div>
          <LanguageSwitcher />
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-8 py-8 space-y-6">
        
        {/* KPI Cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-200">
                <h3 className="text-sm font-medium text-gray-500 uppercase tracking-wide">{t('kpi.totalVolume')}</h3>
                <p className="text-3xl font-bold text-gray-900 mt-2">{totalPages.toLocaleString()} <span className="text-lg text-gray-400 font-normal">{t('kpi.pages')}</span></p>
            </div>
            <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-200">
                <h3 className="text-sm font-medium text-gray-500 uppercase tracking-wide">{t('kpi.readiness')}</h3>
                <p className="text-3xl font-bold text-green-600 mt-2">{progressPercentage}%</p>
            </div>
            <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-200">
                <h3 className="text-sm font-medium text-gray-500 uppercase tracking-wide">{t('kpi.bestDay')}</h3>
                <p className="text-3xl font-bold text-primary-600 mt-2">{t('days.thursday')} <span className="text-lg text-gray-400 font-normal">(90 {t('kpi.pages')})</span></p>
            </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Status Chart */}
            <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-200 flex flex-col min-h-[400px]">
                <h2 className="text-lg font-bold text-gray-800 mb-6 flex items-center gap-2">
                    <PieChartIcon size={20} className="text-gray-400"/>
                    {t('charts.pageStatus')}
                </h2>
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
                        {t(`common:status.${item.name}`)}: {item.value}
                    </div>
                    ))}
                </div>
            </div>

            {/* Activity Chart */}
            <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-200 flex flex-col min-h-[400px]">
                <h2 className="text-lg font-bold text-gray-800 mb-6 flex items-center gap-2">
                    <BarChart3 size={20} className="text-gray-400"/>
                    {t('charts.weeklyActivity')}
                </h2>
                <div className="flex-1">
                    <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={activityData} margin={{ top: 20, right: 30, left: 0, bottom: 5 }}>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f3f4f6" />
                        <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{fontSize: 14, fill: '#6b7280', fontWeight: 600}} dy={10} />
                        <YAxis axisLine={false} tickLine={false} fontSize={12} tick={{fontSize: 12, fill: '#9ca3af'}} />
                        <Tooltip cursor={{fill: '#f0f9ff'}} contentStyle={{borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)'}} />
                        <Bar dataKey="pages" fill="#0284c7" radius={[6, 6, 0, 0]} barSize={40} />
                    </BarChart>
                    </ResponsiveContainer>
                </div>
                <p className="text-center text-sm text-gray-500 mt-4">{t('charts.processedByDay')}</p>
            </div>
        </div>
      </div>
    </div>
  );
};

export default Statistics;