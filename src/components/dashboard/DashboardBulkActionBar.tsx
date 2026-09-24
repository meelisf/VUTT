import { BookOpen, FolderInput, Tag, Users, X } from 'lucide-react';
import FloatingActionBar from '../pagePrep/FloatingActionBar';

interface DashboardBulkActionBarProps {
  selectedCount: number;
  loading: boolean;
  /** Kollektsioon / märksõnad / žanr kirjutavad teose `_metadata.json`-i → admin. */
  canEditMetadata: boolean;
  /** Töökollektsiooni lisamine nõuab ainult kogu haldusõigust (ADR 0031: eri telg). */
  canAddToWorkSet: boolean;
  labels: {
    selectedCount: string;
    assignCollection: string;
    assignTags: string;
    assignGenre: string;
    assignWorkSet: string;
    clearSelection: string;
    exitSelect: string;
  };
  onOpenCollection: () => void;
  onOpenTags: () => void;
  onOpenGenre: () => void;
  onOpenWorkSet: () => void;
  onExitSelectMode: () => void;
}

export default function DashboardBulkActionBar({
  selectedCount,
  loading,
  canEditMetadata,
  canAddToWorkSet,
  labels,
  onOpenCollection,
  onOpenTags,
  onOpenGenre,
  onOpenWorkSet,
  onExitSelectMode,
}: DashboardBulkActionBarProps) {
  if (selectedCount === 0) return null;

  return (
    <FloatingActionBar className="px-4 py-2.5 flex flex-wrap items-center gap-x-3 gap-y-2">
        <span className="text-sm font-medium text-primary-800 shrink-0">
          {labels.selectedCount}
        </span>

        {canEditMetadata && (
        <div className="border-l border-gray-200 pl-3">
          <button
            onClick={onOpenCollection}
            disabled={loading}
            className="flex items-center gap-1.5 px-3 py-1 text-sm bg-primary-600 hover:bg-primary-700 disabled:opacity-50 text-white rounded transition-colors"
          >
            <FolderInput size={14} />
            {labels.assignCollection}
          </button>
        </div>
        )}

        {canEditMetadata && (
        <div className="border-l border-gray-200 pl-3">
          <button
            onClick={onOpenTags}
            disabled={loading}
            className="flex items-center gap-1.5 px-3 py-1 text-sm bg-teal-600 hover:bg-teal-700 disabled:opacity-50 text-white rounded transition-colors"
          >
            <Tag size={14} />
            {labels.assignTags}
          </button>
        </div>
        )}

        {canEditMetadata && (
        <div className="border-l border-gray-200 pl-3">
          <button
            onClick={onOpenGenre}
            disabled={loading}
            className="flex items-center gap-1.5 px-3 py-1 text-sm bg-amber-600 hover:bg-amber-700 disabled:opacity-50 text-white rounded transition-colors"
          >
            <BookOpen size={14} />
            {labels.assignGenre}
          </button>
        </div>
        )}

        {canAddToWorkSet && (
          <div className="border-l border-gray-200 pl-3">
            <button
              onClick={onOpenWorkSet}
              disabled={loading}
              className="flex items-center gap-1.5 px-3 py-1 text-sm bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white rounded transition-colors"
            >
              <Users size={14} />
              {labels.assignWorkSet}
            </button>
          </div>
        )}

        <button
          onClick={onExitSelectMode}
          title={labels.exitSelect}
          className="flex items-center gap-1 px-2 py-1 text-sm font-medium text-red-600 hover:bg-red-50 rounded border-l border-gray-200 pl-3"
        >
          <X size={15} />
          {labels.clearSelection}
        </button>
    </FloatingActionBar>
  );
}
