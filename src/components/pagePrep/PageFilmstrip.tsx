import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Loader2, X } from 'lucide-react';
import { CropIcon, RotateRightIcon, SplitIcon } from '../icons';
import { cardLineLeftPercent } from './geometry';

/** Ühe lehe ootel toimingud ribal; `null` = puutumata. */
export interface FilmstripPending {
  rotate: boolean;
  crop: boolean;
  split: boolean;
}

export interface FilmstripItem {
  key: string;
  /** '' = pilt pole veel valmis (eelvaate renderdus käib) → ootesümbol. */
  src: string;
  imgStyle?: React.CSSProperties;
  /** Poolitusjoon kuvatud pildi laiuse osana; `null` = joont ei näidata. */
  splitX: number | null;
  pending: FilmstripPending | null;
  /** Upload'is teosest välja jäetud leht: tuhm pilt + punane rist (sama mis kontaktlehel). */
  excluded?: boolean;
}

interface Props {
  items: FilmstripItem[];
  currentIndex: number;
  onSelect: (index: number) => void;
  testIdPrefix: string;
}

/**
 * Pildiredaktori parema serva pisipiltide riba: ülevaade kogu teosest ilma
 * ülevaatesse tagasi minemata. Näitab, millisel lehel ollakse ja millistel
 * lehtedel on ootel muudatus (oranž = muudetud, sama kokkulepe mis
 * salvestusnupul); puutumata leht on märgita. Klõps viib lehele.
 *
 * ÜHINE teose halduse pildiredaktorile ja upload'i poolitusvaatele (ADR 0049):
 * komponent ei tea andmeallikast midagi — kumbki vaade koostab `items`-i oma
 * plaanist. Kitsal ekraanil riba peidetakse (lava vajab ruumi rohkem).
 */
const PageFilmstrip: React.FC<Props> = ({ items, currentIndex, onSelect, testIdPrefix }) => {
  const { t } = useTranslation('common');
  // Pildi loomulik kuvasuhe — joon käib pildi, mitte kasti laiuse järgi (cardLineLeftPercent).
  const [aspects, setAspects] = useState<Record<string, number>>({});
  const currentRef = useRef<HTMLButtonElement>(null);

  // Praegune leht hoitakse nähtaval (ka ‹ › ja „Märgi ja järgmine" järel).
  // `nearest`: ei keri, kui leht on juba näha — riba ei hüple iga klõpsuga.
  useEffect(() => {
    currentRef.current?.scrollIntoView?.({ block: 'nearest' });
  }, [currentIndex]);

  return (
    <nav
      aria-label={t('pagePrep.filmstrip')}
      data-testid={`${testIdPrefix}-filmstrip`}
      className="hidden w-24 flex-shrink-0 flex-col gap-2 overflow-y-auto pr-1 lg:flex"
    >
      {items.map((item, i) => {
        const current = i === currentIndex;
        const p = item.pending;
        const lineLeft = item.splitX === null ? null : cardLineLeftPercent(aspects[item.key], item.splitX);
        return (
          <button
            key={item.key}
            ref={current ? currentRef : undefined}
            type="button"
            data-testid={`${testIdPrefix}-filmstrip-${i}`}
            data-pending={p ? 'true' : 'false'}
            aria-current={current ? 'page' : undefined}
            title={p ? `${t('pagePrep.page', { cur: i + 1, total: items.length })} · ${t('pagePrep.filmstripPending')}`
              : t('pagePrep.page', { cur: i + 1, total: items.length })}
            onClick={() => onSelect(i)}
            className={`relative aspect-[3/4] w-full flex-shrink-0 overflow-hidden rounded border bg-gray-100 ${
              current ? 'border-indigo-600 ring-2 ring-indigo-500'
                : item.excluded ? 'border-red-400 ring-1 ring-red-300'
                : p ? 'border-amber-400 ring-1 ring-amber-300 hover:border-amber-500'
                : 'border-gray-200 hover:border-gray-400'
            }`}
          >
            {item.src ? (
              <img
                src={item.src}
                alt=""
                loading="lazy"
                draggable={false}
                style={item.imgStyle}
                onLoad={(e) => {
                  const img = e.currentTarget;
                  if (!img.naturalHeight) return;
                  const ratio = img.naturalWidth / img.naturalHeight;
                  setAspects((prev) => (prev[item.key] === ratio ? prev : { ...prev, [item.key]: ratio }));
                }}
                className={`h-full w-full object-contain ${item.excluded ? 'opacity-35' : ''}`}
              />
            ) : (
              <span className="flex h-full w-full items-center justify-center">
                <Loader2 size={14} className="animate-spin text-gray-400" />
              </span>
            )}
            {lineLeft !== null && (
              <span
                data-testid={`${testIdPrefix}-filmstrip-line-${i}`}
                className="pointer-events-none absolute bottom-0 top-0 w-px bg-rose-600"
                style={{ left: `${lineLeft}%` }}
              />
            )}
            <span className="absolute bottom-0.5 left-0.5 rounded bg-white/90 px-1 text-[10px] leading-tight text-gray-700 shadow-sm">
              {i + 1}
            </span>
            {item.excluded ? (
              <span data-testid={`${testIdPrefix}-filmstrip-excluded-${i}`}
                className="absolute right-0.5 top-0.5 rounded bg-red-600 p-0.5 text-white shadow-sm">
                <X size={10} />
              </span>
            ) : p && (
              <span
                data-testid={`${testIdPrefix}-filmstrip-pending-${i}`}
                className="absolute right-0.5 top-0.5 flex items-center gap-0.5 rounded border border-amber-300 bg-amber-100 px-0.5 py-0.5 text-amber-800 shadow-sm"
              >
                {p.rotate && <RotateRightIcon size={10} />}
                {p.crop && <CropIcon size={10} />}
                {p.split && <SplitIcon size={10} />}
              </span>
            )}
          </button>
        );
      })}
    </nav>
  );
};

export default PageFilmstrip;
