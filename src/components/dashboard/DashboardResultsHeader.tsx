import { CheckSquare, LayoutGrid, List, Square } from 'lucide-react';
import type { ResultsView } from '../../contexts/UserContext';

interface DashboardResultsHeaderProps {
  /**
   * Kas valikurežiim on üldse lubatud. EI OLE sama mis `isAdmin`: kolm õiguste
   * telge on eraldi (ADR 0031), ja töökollektsiooni haldur võib olla
   * contributor. Millised tegevused ribal näha on, otsustab riba ise.
   */
  canSelect: boolean;
  hasWorks: boolean;
  selectMode: boolean;
  selectedCount: number;
  statusFiltered: boolean;
  totalPages: number;
  view: ResultsView;
  labels: {
    bookshelf: string;
    enterSelect: string;
    exitSelect: string;
    select: string;
    selectAllVisible: string;
    clearSelection: string;
    worksCount: string;
    filtered: string;
    pageOf: string;
    viewCards: string;
    viewList: string;
    viewGroup: string;
  };
  onToggleSelectMode: () => void;
  onSelectAllVisible: () => void;
  onClearSelection: () => void;
  onViewChange: (view: ResultsView) => void;
}

export default function DashboardResultsHeader({
  canSelect,
  hasWorks,
  selectMode,
  selectedCount,
  statusFiltered,
  totalPages,
  view,
  labels,
  onToggleSelectMode,
  onSelectAllVisible,
  onClearSelection,
  onViewChange,
}: DashboardResultsHeaderProps) {
  return (
    <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-2 mb-6 border-b border-gray-200 pb-3">
      <div className="flex items-center gap-4">
        <h2 className="text-xl font-bold text-gray-800">{labels.bookshelf}</h2>
        {canSelect && hasWorks && (
          <button
            onClick={onToggleSelectMode}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg transition-colors ${
              selectMode
                ? 'bg-primary-100 text-primary-700 font-medium'
                : 'text-gray-500 hover:bg-gray-100'
            }`}
            title={selectMode ? labels.exitSelect : labels.enterSelect}
          >
            {selectMode ? <CheckSquare size={16} /> : <Square size={16} />}
            {selectMode ? labels.exitSelect : labels.select}
          </button>
        )}
      </div>
      <div className="flex items-center gap-4">
        {selectMode && (
          <div className="flex items-center gap-2 text-sm">
            <button
              onClick={onSelectAllVisible}
              className="text-primary-600 hover:text-primary-800 font-medium"
            >
              {labels.selectAllVisible}
            </button>
            {selectedCount > 0 && (
              <>
                <span className="text-gray-300">|</span>
                <button
                  onClick={onClearSelection}
                  className="text-gray-500 hover:text-gray-700"
                >
                  {labels.clearSelection}
                </button>
              </>
            )}
          </div>
        )}

        <span className="text-sm text-gray-500">
          {labels.worksCount} {statusFiltered && labels.filtered} {totalPages > 1 && `• ${labels.pageOf}`}
        </span>

        {hasWorks && (
          <div className="flex border border-gray-300 rounded overflow-hidden bg-white" role="group" aria-label={labels.viewGroup}>
            {([['cards', LayoutGrid, labels.viewCards], ['list', List, labels.viewList]] as const).map(([v, Icon, label], i) => (
              <button
                key={v}
                type="button"
                onClick={() => onViewChange(v)}
                aria-pressed={view === v}
                title={label}
                aria-label={label}
                className={`p-1.5 ${i > 0 ? 'border-l border-gray-300' : ''} ${
                  view === v ? 'bg-gray-100 text-gray-900' : 'text-gray-400 hover:text-gray-700'
                }`}
              >
                <Icon size={16} />
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
