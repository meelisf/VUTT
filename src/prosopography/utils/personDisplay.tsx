/**
 * Isiku kuvaread, mida jagavad ruudustiku kaart (`PersonCard`) ja loendirida
 * (`PersonListRow`, #587). Üks allikas: kaks koopiat läheksid lahku.
 */
import React from 'react';
import { useTranslation } from 'react-i18next';
import type { ProsopoIndexEntry } from '../types';
import type { VocabularySeisusItem } from '../../services/collectionService';
import { formatFloruit } from './personDates';

export function resolveLabel(labels: Record<string, string> | null | undefined, lang: string): string | null {
  if (!labels) return null;
  return labels[lang] ?? labels['et'] ?? labels['en'] ?? Object.values(labels)[0] ?? null;
}

/**
 * Päritolu tekst: „ajalooline nimi (tänapäevane) · ülemüksus", varuks
 * päritolugrupp. `hasPlace` = tekst tuleb kohast (mitte grupist) — ainult siis
 * saab teda kaardil näidata.
 */
export function personOrigin(person: ProsopoIndexEntry, lang: string): { text: string | null; hasPlace: boolean } {
  const historical = person.origin_place;
  const modern = resolveLabel(person.origin_place_labels, lang);
  const placeLabel = historical
    ? (modern && modern !== historical ? `${historical} (${modern})` : historical)
    : (modern ?? null);
  if (placeLabel) {
    const parentLabel = resolveLabel(person.origin_parent?.labels, lang) ?? person.origin_parent?.key;
    return {
      text: parentLabel && placeLabel !== parentLabel ? `${placeLabel} · ${parentLabel}` : placeLabel,
      hasPlace: true,
    };
  }
  if (person.origin_group) {
    return { text: resolveLabel(person.origin_group_labels, lang) ?? person.origin_group, hasPlace: false };
  }
  return { text: null, hasPlace: false };
}

/** Seisus aktiivses keeles (status_ids → sõnavara), varuks `status_labels` (eesti). */
export function personStatusText(person: ProsopoIndexEntry, vocab: VocabularySeisusItem[] | undefined, isEn: boolean): string {
  if ((person.status_ids ?? []).length > 0) {
    return person.status_ids.map((sid, i) => {
      const item = vocab?.find(s => s.id === sid);
      const loc = item ? (isEn ? item.label.en : item.label.et) : null;
      return loc || person.status_labels?.[i] || sid;
    }).filter(Boolean).join(', ');
  }
  return (person.status_labels ?? []).join(', ');
}

/** Eluaastad; nende puudumisel tegutsemisperiood, et lahter ei jääks tühjaks (#240). */
export const Lifespan: React.FC<{ person: ProsopoIndexEntry }> = ({ person }) => {
  const { t } = useTranslation(['prosopography']);
  const sym = 'text-primary-500';
  const b = person.birth_year ? <><span className={sym}>*</span>{person.birth_year}</> : null;
  const d = person.death_year ? <><span className={sym}>†</span>{person.death_year}</> : null;
  if (b && d) return <>{b}{'  '}{d}</>;
  if (b) return b;
  if (d) return d;
  const fl = formatFloruit(person.floruit_year_from, person.floruit_year_to);
  if (fl) return <><span className={sym}>{t('floruitShort')}</span>{fl}</>;
  return <span>{t('unknownYears', 'eluaastad teadm.')}</span>;
};

// Deterministlik taustavärv nime põhjal (igal isikul unikaalne muted toon)
const nameToColor = (name: string): { bg: string; fg: string } => {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  const hue = Math.abs(hash) % 360;
  return {
    bg: `hsl(${hue}, 20%, 90%)`,
    fg: `hsl(${hue}, 25%, 52%)`,
  };
};

/** Initsiaalid varufotona (nagu WorkCard thumbnail fallback). `textClass` = suurus. */
export const Initials: React.FC<{ name: string; textClass?: string }> = ({ name, textClass = 'text-3xl' }) => {
  const parts = name.trim().split(/\s+/);
  const initials = parts.length >= 2
    ? (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
    : name.slice(0, 2).toUpperCase();
  const { bg, fg } = nameToColor(name);
  return (
    <div className="w-full h-full flex items-center justify-center" style={{ backgroundColor: bg }}>
      <span className={`${textClass} font-bold select-none`} style={{ color: fg }}>{initials}</span>
    </div>
  );
};

/** Kontrollitaseme täpp (kaardi ja loendirea paremas servas). */
export const verificationDotClass = (level: string): string => {
  switch (level) {
    case 'verified': return 'bg-green-500';
    case 'reviewed': return 'bg-amber-400';
    default:         return 'bg-gray-300';
  }
};
