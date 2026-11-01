import React, { useLayoutEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import type { ConvoluteBlock } from '../../types';
import { formatYearDisplay } from '../../utils/yearDisplayUtils';
import { workDisplayTitle } from '../../utils/workTitle';

interface ConvoluteBlocksProps {
  blocks: ConvoluteBlock[];
  lang: string;
  /** Ülekate tumedal taustal (kaart) vs infopaneel heledal. */
  dark?: boolean;
}

/**
 * Plokid „Samas köites" (#702, ADR 0076 p 6) — ühine infopaneelile ja kaardi
 * ülekattele. Iga konvoluudis olev eksemplar annab oma ploki; rühma, järjestuse
 * ja piiratud liikme (`readable: false`) otsustab server.
 */
const ConvoluteBlocks: React.FC<ConvoluteBlocksProps> = ({ blocks, lang, dark = false }) => {
  if (blocks.length === 0) return null;
  return (
    <div className="space-y-3">
      {blocks.map(b => <OneBlock key={b.exemplar_id} block={b} lang={lang} dark={dark} />)}
    </div>
  );
};

const OneBlock: React.FC<{ block: ConvoluteBlock; lang: string; dark: boolean }> = ({ block, lang, dark }) => {
  const { t } = useTranslation(['common']);
  const [showContents, setShowContents] = useState(false);
  // Laiendusnupp ainult siis, kui `line-clamp-2` midagi tegelikult peidab (mõõdetakse kärbitult).
  const contentsRef = useRef<HTMLSpanElement | null>(null);
  const [clamped, setClamped] = useState(false);
  useLayoutEffect(() => {
    const el = contentsRef.current;
    if (el && !showContents) setClamped(el.scrollHeight > el.clientHeight + 1);
  }, [block.contents, showContents]);
  const muted = dark ? 'text-gray-400' : 'text-gray-500';
  const total = block.total ?? null;
  // VUTT-is puuduvad trükised: ainult siis, kui arv on teada (ADR 0076: kirjet neist ei looda).
  const missing = total !== null ? Math.max(0, total - block.members.length) : 0;
  const orderUnknown = block.members.length > 1 && block.members.every(m => m.position == null);

  const positionLabel = (p?: number | null) => {
    if (p == null) return '—';
    return p === 0 ? t('common:convolute.main') : t('common:convolute.position', { n: p });
  };

  return (
    <div data-testid="convolute-block">
      <p className={`text-[11px] ${muted} mb-1`}>
        <span className="font-medium">{block.holder} {block.reference}</span>
        {total !== null && <> · {t('common:convolute.total', { count: total })}</>}
      </p>
      <ul className="space-y-1">
        {block.members.map(m => {
          const title = workDisplayTitle(m, lang).main;
          const year = formatYearDisplay(m.year_display ?? null, m.year ?? 0, t, m.dating ?? null);
          const linkable = m.readable && !m.current;
          return (
            <li key={`${m.work_id}:${m.exemplar_id}`}
                className={`flex items-start gap-2 text-sm ${m.current ? (dark ? 'bg-white/10 rounded px-1' : 'bg-amber-50 rounded px-1') : ''}`}
                aria-current={m.current ? 'true' : undefined}>
              <span className={`text-xs ${muted} w-16 shrink-0 pt-0.5`}>{positionLabel(m.position)}</span>
              <span className="min-w-0 flex-1">
                {linkable ? (
                  <Link to={`/work/${m.work_id}/1`} onClick={e => e.stopPropagation()}
                        className={`${dark ? 'text-white hover:text-emerald-200' : 'text-primary-700 hover:text-primary-900'} hover:underline line-clamp-2`}>
                    {title}
                  </Link>
                ) : (
                  <span className={`${dark ? 'text-gray-200' : 'text-gray-700'} line-clamp-2 ${m.current ? 'font-medium' : ''}`}>{title}</span>
                )}
                <span className={`block text-xs ${muted}`}>
                  {year}
                  {m.current && <span className="ml-1">← {t('common:convolute.thisWork')}</span>}
                  {!m.readable && <span className="ml-1 italic">{t('common:workRelations.restricted')}</span>}
                </span>
              </span>
            </li>
          );
        })}
      </ul>
      {missing > 0 && <p className={`text-xs ${muted} mt-1`}>{t('common:convolute.missing', { count: missing })}</p>}
      {orderUnknown && <p className={`text-xs ${muted} mt-1 italic`}>{t('common:convolute.orderUnknown')}</p>}
      {block.contents && (
        <div className={`text-xs ${muted} mt-1`}>
          <span className="font-medium">{t('common:convolute.contents')}:</span>{' '}
          <span ref={contentsRef} className={`whitespace-pre-wrap ${showContents ? '' : 'line-clamp-2'}`}>{block.contents}</span>
          {(clamped || showContents) && <button type="button" onClick={e => { e.stopPropagation(); setShowContents(v => !v); }}
                  className={`block mt-0.5 ${dark ? 'text-emerald-200' : 'text-primary-700'} hover:underline`}>
            {showContents ? t('common:convolute.hideContents') : t('common:convolute.showContents')}
          </button>}
        </div>
      )}
    </div>
  );
};

export default ConvoluteBlocks;
