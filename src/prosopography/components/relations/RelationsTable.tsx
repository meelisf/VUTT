// src/prosopography/components/relations/RelationsTable.tsx
/** Seosed tabelina (#461): tekstivaade diagrammidele, ühtlasi ligipääsetav alternatiiv. */
import React from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type { VisibleNetwork } from '../../utils/network';

const RelationsTable: React.FC<{ net: VisibleNetwork }> = ({ net }) => {
  const { t } = useTranslation(['prosopography']);
  const rows = [...net.persons].sort((a, b) => (a.firstYear ?? 9999) - (b.firstYear ?? 9999) || a.label.localeCompare(b.label));
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-gray-200 text-left text-gray-500">
            <th className="py-1.5 pr-3 font-semibold">{t('network.table.person')}</th>
            <th className="py-1.5 pr-3 font-semibold">{t('network.table.years')}</th>
            <th className="py-1.5 pr-3 font-semibold">{t('network.table.origin')}</th>
            <th className="py-1.5 pr-3 font-semibold">{t('network.table.kind')}</th>
            <th className="py-1.5 pr-3 font-semibold">{t('network.table.works')}</th>
            <th className="py-1.5 font-semibold">{t('network.table.span')}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(p => {
            const ys = p.edges.map(e => e.year).filter((y): y is number => typeof y === 'number');
            const span = ys.length ? (Math.min(...ys) === Math.max(...ys) ? `${ys[0]}` : `${Math.min(...ys)}–${Math.max(...ys)}`) : '—';
            return (
              <tr key={p.id} className="border-b border-gray-100 align-top">
                <td className="py-1.5 pr-3"><Link to={`/persons/${p.id}`} className="text-primary-700 hover:underline">{p.label}</Link></td>
                <td className="py-1.5 pr-3 tabular-nums">{p.birth_year || p.death_year ? `${p.birth_year ?? '?'}–${p.death_year ?? '?'}` : '—'}</td>
                <td className="py-1.5 pr-3">{p.origin?.place ?? '—'}</td>
                <td className="py-1.5 pr-3">{t(`network.kinds.${p.kind}`)}</td>
                <td className="py-1.5 pr-3 tabular-nums">{p.workCount}</td>
                <td className="py-1.5 tabular-nums">{span}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
};

export default RelationsTable;
