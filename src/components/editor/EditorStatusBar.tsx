import { useTranslation } from 'react-i18next';
import { PageStatus } from '../../types';

interface EditorStatusBarProps {
  status: PageStatus;
  readOnly: boolean;
  onStatusChange?: (status: PageStatus) => void;
}

// Lehekülje staatuse kuvamine/muutmine redaktori tööriistaribal.
export default function EditorStatusBar({ status, readOnly, onStatusChange }: EditorStatusBarProps) {
  const { t } = useTranslation(['workspace', 'common']);
  const colorClass =
    status === PageStatus.DONE ? 'bg-green-50 text-green-700 border-green-200' :
    status === PageStatus.IN_PROGRESS ? 'bg-amber-50 text-amber-700 border-amber-200' :
    status === PageStatus.CORRECTED ? 'bg-blue-50 text-blue-700 border-blue-200' :
    'bg-gray-50 text-gray-700 border-gray-200';

  return (
    <div className="flex items-center gap-2 shrink-0">
      <span className="text-[10px] text-gray-400 uppercase tracking-wide hidden sm:block">{t('status.label')}</span>
      {onStatusChange && !readOnly ? (
        <select
          value={status}
          onChange={(e) => onStatusChange(e.target.value as PageStatus)}
          className={`text-xs font-bold uppercase px-2 py-1 rounded-full border outline-none transition-all cursor-pointer ${colorClass} hover:opacity-80`}
        >
          {Object.values(PageStatus).map((s) => (
            <option key={s} value={s}>{t(`common:status.${s}`)}</option>
          ))}
        </select>
      ) : (
        <span
          className={`text-xs font-bold uppercase px-2 py-1 rounded-full border cursor-help ${colorClass}`}
          title={t(`common:statusHelp.${status}`)}
        >
          {t(`common:status.${status}`)}
        </span>
      )}
    </div>
  );
}
