/** Osade sisukord (#464): teose järjekorras, esimese lehe järgi; needs_review esile tõstetud. */
import React from 'react';
import { useTranslation } from 'react-i18next';
import { AlertTriangle } from 'lucide-react';
import type { WorkPart } from '../../../services/workPartsApi';
import { KIND_STYLE } from './kindStyle';

interface Props {
  parts: WorkPart[];      // juba sortParts järjekorras
  activeId: string | null;
  onSelect: (id: string) => void;
}

const PartsList: React.FC<Props> = ({ parts, activeId, onSelect }) => {
  const { t } = useTranslation(['workspace']);
  if (parts.length === 0) {
    return <p className="text-sm text-gray-500">{t('manage.parts.empty')}</p>;
  }
  return (
    <ol className="max-h-[70vh] space-y-1 overflow-y-auto">
      {parts.map((p, i) => {
        const who = p.creators.find(c => c.role === 'auctor')?.name ?? p.creators[0]?.name;
        const year = p.dating?.start?.slice(0, 4);
        return (
          <li key={p.id}>
            <button
              type="button"
              data-testid={`part-${p.id}`}
              onClick={() => onSelect(p.id)}
              className={`w-full rounded border px-2 py-1.5 text-left text-sm ${
                activeId === p.id ? 'border-primary-400 bg-primary-50' : 'border-gray-200 bg-white hover:bg-gray-50'
              }`}
            >
              <div className="flex items-center gap-1.5">
                <span className={`rounded px-1 text-[10px] font-semibold ${KIND_STYLE[p.kind]}`}>{i + 1}</span>
                <span className="text-xs text-gray-500">{t(`manage.parts.kinds.${p.kind}`)}</span>
                {year && <span className="ml-auto text-xs tabular-nums text-gray-500">{year}</span>}
              </div>
              <div className="truncate text-gray-800">{p.title || who || t('manage.parts.none')}</div>
              {p.needs_review ? (
                <div className="mt-0.5 flex items-center gap-1 text-xs text-amber-700">
                  <AlertTriangle size={12} /> {t('manage.parts.needsReview')}
                </div>
              ) : (
                <div className="text-xs text-gray-500">{t('manage.parts.pages', { count: p.pages.length })}</div>
              )}
            </button>
          </li>
        );
      })}
    </ol>
  );
};

export default PartsList;
