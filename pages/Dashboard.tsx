
import React, { useState, useEffect } from 'react';
import { searchWorks, updateApiKey, getCurrentKeyType } from '../services/meiliService';
import { Work } from '../types';
import WorkCard from '../components/WorkCard';
import { Search, BarChart3, AlertTriangle, Settings, Key, FileText } from 'lucide-react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';

const Dashboard: React.FC = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const queryParam = searchParams.get('q') || '';
  
  const [inputValue, setInputValue] = useState(queryParam);
  const [works, setWorks] = useState<Work[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  
  // Year filter state - keeping it simple and always visible
  const [yearStart, setYearStart] = useState<string>('1630');
  const [yearEnd, setYearEnd] = useState<string>('1710');
  
  const navigate = useNavigate();

  // Sync input with URL param (e.g. back button)
  useEffect(() => {
    setInputValue(queryParam);
  }, [queryParam]);

  // Debounce input updates to URL
  useEffect(() => {
    const timer = setTimeout(() => {
        if (inputValue !== queryParam) {
            setSearchParams(prev => {
                if (inputValue) prev.set('q', inputValue);
                else prev.delete('q');
                return prev;
            }, { replace: true });
        }
    }, 400);
    return () => clearTimeout(timer);
  }, [inputValue, setSearchParams, queryParam]);

  // Perform search when queryParam OR year filters change
  useEffect(() => {
    const fetchWorks = async () => {
      setLoading(true);
      setError(null);
      try {
        const start = parseInt(yearStart) || undefined;
        const end = parseInt(yearEnd) || undefined;
        
        // Pass filter options to the API instead of filtering locally
        const results = await searchWorks(queryParam, {
            yearStart: start,
            yearEnd: end
        });
        setWorks(results);
      } catch (e: any) {
        console.error("Search failed", e);
        setError(e.message || "Tundmatu viga ühenduse loomisel.");
      } finally {
        setLoading(false);
      }
    };

    const timer = setTimeout(() => {
        fetchWorks();
    }, 400); // Debounce both search and filters slightly

    return () => clearTimeout(timer);
  }, [queryParam, yearStart, yearEnd]);

  const handleSettings = async () => {
      const currentType = getCurrentKeyType();
      const newKey = window.prompt(
          `Sisesta Meilisearch Master Key (Admin API Key).\n\nHetkel kasutusel: ${currentType === 'default' ? 'Avalik võti (Config)' : 'Sinu isiklik võti (LocalStorage)'}.\n\nJäta tühjaks, et eemaldada isiklik võti ja kasutada vaikeväärtust.`,
          ''
      );

      if (newKey !== null) {
          try {
              await updateApiKey(newKey.trim());
              alert("Võti uuendatud! Palun värskenda lehte (F5), et muudatused kindlasti rakenduksid.");
              window.location.reload();
          } catch (e: any) {
              alert("Viga võtme seadistamisel: " + e.message);
          }
      }
  };

  return (
    <div className="flex flex-col h-full bg-gray-50 font-sans">
      {/* Header */}
      <header className="bg-white border-b border-gray-200 px-8 py-4 flex items-center justify-between sticky top-0 z-20 shadow-sm">
        <div className="flex items-center gap-6">
          <div>
            <h1 className="text-2xl font-bold text-primary-900 tracking-tight">VUTT</h1>
            <p className="text-xs text-gray-500 font-medium tracking-wide uppercase">Varauusaegsete tekstide töölaud</p>
          </div>
          <div className="h-8 w-px bg-gray-200 hidden sm:block"></div>
          <Link 
            to="/stats"
            className="hidden sm:flex items-center gap-2 text-sm font-medium text-gray-600 hover:text-primary-600 hover:bg-primary-50 px-3 py-1.5 rounded-lg transition-colors"
          >
            <BarChart3 size={18} />
            Vaata statistikat
          </Link>
        </div>
        <div className="flex items-center gap-4">
          <button 
            onClick={handleSettings}
            className="p-2 text-gray-500 hover:bg-gray-100 rounded-full transition-colors flex items-center gap-2"
            title="Seaded / API Võti"
          >
             <Settings size={20} />
             {getCurrentKeyType() === 'custom' && <Key size={12} className="text-green-600" />}
          </button>
          <div className="h-6 w-px bg-gray-200"></div>
          <div className="text-right">
             <p className="text-sm font-semibold text-gray-900">Dr. Mari Maasikas</p>
             <p className="text-xs text-gray-500">Uurija</p>
          </div>
          <div className="h-9 w-9 bg-primary-100 rounded-full flex items-center justify-center text-primary-700 font-bold border-2 border-primary-200 text-sm">
            MM
          </div>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto">
        <div className="max-w-7xl mx-auto px-8 py-8">
          
          {/* Error Banner */}
          {error && (
             <div className="mb-6 bg-red-50 border-l-4 border-red-500 p-4 rounded-r shadow-sm flex items-start gap-3">
                <AlertTriangle className="text-red-500 shrink-0 mt-0.5" size={20} />
                <div>
                    <h3 className="font-bold text-red-800">Ühenduse viga</h3>
                    <p className="text-sm text-red-700 mt-1">{error}</p>
                    <p className="text-xs text-red-600 mt-2">
                        Kui kasutad eelvaadet HTTPS-iga, aga server on HTTP (172.x.x.x), siis brauser blokeerib selle.
                        Proovi avada rakendus lokaalselt või HTTP kaudu.
                    </p>
                </div>
             </div>
          )}

          {/* Search & Filter Section */}
          <div className="mb-10 max-w-4xl mx-auto">
             <div className="flex flex-col gap-4">
                {/* Search Bar */}
                <div className="relative flex-1">
                  <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" size={20} />
                  <input
                    type="text"
                    placeholder="Otsi teost pealkirja või autori järgi..."
                    value={inputValue}
                    onChange={(e) => setInputValue(e.target.value)}
                    className="w-full pl-12 pr-4 py-3 rounded-lg border border-gray-300 shadow-sm focus:ring-2 focus:ring-primary-100 focus:border-primary-500 outline-none transition-shadow text-lg"
                  />
                </div>
                
                {/* Controls Row */}
                <div className="flex flex-col sm:flex-row items-center justify-between gap-4 bg-white p-3 rounded-lg border border-gray-200 shadow-sm">
                    {/* Year Filter */}
                    <div className="flex items-center gap-3 w-full sm:w-auto">
                        <span className="text-xs font-bold text-gray-500 uppercase tracking-wide whitespace-nowrap">Ajavahemik:</span>
                        <div className="flex items-center gap-2">
                            <input 
                                type="number" 
                                value={yearStart} 
                                onChange={(e) => setYearStart(e.target.value)}
                                className="w-20 p-1.5 border border-gray-300 rounded text-sm focus:border-primary-500 outline-none text-center"
                                placeholder="1630"
                            />
                            <span className="text-gray-300 font-bold">-</span>
                            <input 
                                type="number" 
                                value={yearEnd} 
                                onChange={(e) => setYearEnd(e.target.value)}
                                className="w-20 p-1.5 border border-gray-300 rounded text-sm focus:border-primary-500 outline-none text-center"
                                placeholder="1710"
                            />
                        </div>
                    </div>

                    <div className="h-6 w-px bg-gray-200 hidden sm:block"></div>

                    {/* Action Button */}
                    <button
                        onClick={() => navigate('/search')}
                        className="w-full sm:w-auto px-4 py-2 bg-primary-50 text-primary-700 hover:bg-primary-100 rounded-md font-bold text-sm transition-colors flex items-center justify-center gap-2"
                    >
                        <FileText size={16} />
                        Ava täisteksti otsing
                    </button>
                </div>
             </div>
          </div>

          {/* Results Grid */}
          <div className="max-w-7xl mx-auto">
            <div className="flex justify-between items-center mb-6 border-b border-gray-200 pb-3">
              <h2 className="text-xl font-bold text-gray-800">Raamaturiiul</h2>
              <span className="text-sm text-gray-500">
                  {works.length} teost nähtaval
                  {!inputValue && !queryParam && " (viimati muudetud)"}
              </span>
            </div>
            
            {loading ? (
               <div className="flex justify-center py-20">
                   {/* Skeleton loader items could go here */}
                   <div className="flex flex-col items-center gap-2">
                      <div className="w-8 h-8 border-4 border-primary-200 border-t-primary-600 rounded-full animate-spin"></div>
                      <span className="text-gray-400 text-sm">Laen riiulit...</span>
                   </div>
               </div>
            ) : works.length > 0 ? (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
                {works.map(work => (
                  <WorkCard key={work.id} work={work} />
                ))}
              </div>
            ) : (
              <div className="text-center py-16 bg-white rounded-xl border border-gray-200 border-dashed">
                <p className="text-gray-400 text-lg">Valitud kriteeriumitele vastavaid teoseid ei leitud.</p>
                {!error && (
                    <div className="mt-2 text-sm text-gray-400">
                        Kontrolli, kas Meilisearchis on andmeid ja kas aastaarvud on õiged.
                    </div>
                )}
                <button 
                    onClick={() => {setInputValue(''); setSearchParams({}); setYearStart('1630'); setYearEnd('1710');}}
                    className="mt-4 text-primary-600 font-medium hover:underline"
                >
                    Taasta vaikeseaded
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default Dashboard;
