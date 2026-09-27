/**
 * Osade sisukord (#464): tabel teose järjekorras (esimese lehe järgi), täislaiuses
 * „Sisukord" vaates. needs_review on esile tõstetud; rea klikk avab osa paneelis.
 */
import React from 'react';
import { useTranslation } from 'react-i18next';
import { AlertTriangle } from 'lucide-react';
import type { WorkPart } from '../../../services/workPartsApi';
import { pageRanges } from '../partsModel';
import { KIND_STYLE } from './kindStyle';

interface Props {
  parts: WorkPart[];      // juba sortParts järjekorras
  pageNums: Map<string, number>;
  activeId: string | null;
  onSelect: (id: string) => void;
}

const PartsList: React.FC<Props> = ({ parts, pageNums, activeId, onSelect }) => {
  const { t } = useTranslation(['workspace']);
  if (parts.length === 0) {
    return <p className="text-sm text-gray-500">{t('manage.parts.empty')}</p>;
  }
  const th = 'px-3 py-2 text-left text-xs font-bold uppercase text-gray-500';
  return (
    <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
      <table className="w-full text-sm">
        <thead className="border-b border-gray-200 bg-gray-50">
          <tr>
            <th className={`${th} w-12`}>{t('manage.parts.colNo')}</th>
            <th className={`${th} w-28`}>{t('manage.parts.kind')}</th>
            <th className={th}>{t('manage.parts.colWho')}</th>
            <th className={`${th} w-28`}>{t('manage.parts.dating')}</th>
            <th className={`${th} w-32`}>{t('manage.parts.colPages')}</th>
          </tr>
        </thead>
        <tbody>
          {parts.map((p, i) => {
            const who = p.creators.filter(c => c.name).map(c => c.name).join(' → ');
            const year = p.dating?.start?.slice(0, 4);
            return (
              <tr
                key={p.id}
                data-testid={`part-${p.id}`}
                onClick={() => onSelect(p.id)}
                className={`cursor-pointer border-b border-gray-100 last:border-0 ${
                  activeId === p.id ? 'bg-primary-50' : 'hover:bg-gray-50'
                }`}
              >
                <td className="px-3 py-2">
                  <span className={`rounded px-1.5 text-[11px] font-semibold ${KIND_STYLE[p.kind]}`}>{i + 1}</span>
                </td>
                <td className="px-3 py-2 text-gray-600">{t(`manage.parts.kinds.${p.kind}`)}</td>
                <td className="px-3 py-2">
                  {/* Nupp klaviatuurile; rea klikk on hiirele mugavus */}
                  <button type="button" onClick={e => { e.stopPropagation(); onSelect(p.id); }}
                    className="text-left text-gray-800 hover:text-primary-700 hover:underline">
                    {p.title || who || t('manage.parts.none')}
                  </button>
                  {p.title && who && <div className="text-xs text-gray-500">{who}</div>}
                  {p.incipit && <div className="truncate text-xs italic text-gray-400">{p.incipit}</div>}
                </td>
                <td className="px-3 py-2 tabular-nums text-gray-600">{year ?? ''}</td>
                <td className="px-3 py-2 tabular-nums text-gray-600">
                  {p.needs_review ? (
                    <span className="flex items-center gap-1 text-xs text-amber-700">
                      <AlertTriangle size={12} /> {t('manage.parts.needsReview')}
                    </span>
                  ) : (
                    <span title={t('manage.parts.pages', { count: p.pages.length })}>{pageRanges(p.pages, pageNums)}</span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
};

export default PartsList;
