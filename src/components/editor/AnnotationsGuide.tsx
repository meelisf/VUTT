// src/components/editor/AnnotationsGuide.tsx
/**
 * Tähelepanujuht „Teose info" päises: vaiksed pillid selle kohta, mis on teosele
 * või lehele baasinfo kõrvale lisatud (sisukord, töökollektsioonid, märksõnad,
 * annotatsioonid, märkmed). Pill on ainult olemasoleva sisu kohta; märkmeteta
 * lehel kutsub „Lisa märge". Paneelid ise jäävad oma kohale — klõps kerib sinna.
 * Paigutus ei sõltu rollist; „Lisa märge" järgib ainult kirjutusõigust.
 */
import React from 'react';
import { useTranslation } from 'react-i18next';
import {
  Bookmark, ListOrdered, MessageSquare, MessageSquarePlus, SquarePen, Tag, Tags, type LucideIcon,
} from 'lucide-react';

export type GuideKey = 'toc' | 'workSets' | 'workTags' | 'pageTags' | 'textAnnotations' | 'pageNotes' | 'addNote';
export type GuideCounts = Partial<Record<Exclude<GuideKey, 'addNote'>, number>>;

interface Props {
  counts: GuideCounts;
  canAddNote: boolean;
  onJump: (key: GuideKey) => void;
}

// Järjekord = paneelide järjekord veerus. Numbri värv = paneeli päise ikooni värv,
// et pill ja paneel seostuksid (kollane üks aste tumedam loetavuse pärast).
const ITEMS: { key: Exclude<GuideKey, 'addNote'>; icon: LucideIcon; tone: string }[] = [
  { key: 'toc', icon: ListOrdered, tone: 'text-primary-600' },
  { key: 'workSets', icon: Bookmark, tone: 'text-violet-600' },
  { key: 'workTags', icon: Tags, tone: 'text-green-600' },
  { key: 'textAnnotations', icon: SquarePen, tone: 'text-yellow-600' },
  { key: 'pageTags', icon: Tag, tone: 'text-primary-600' },
  { key: 'pageNotes', icon: MessageSquare, tone: 'text-amber-700' },
];

const base = 'inline-flex items-center gap-1.5 text-xs rounded-full border px-2.5 py-0.5 transition-colors';
const calm = `${base} text-gray-700 border-gray-200 bg-gray-50 hover:bg-gray-100 hover:border-gray-300`;
// Märkmed ootavad toimetajalt tegutsemist — ainus soe toon
const warm = `${base} text-amber-800 border-amber-300 bg-amber-50 hover:bg-amber-100`;

const AnnotationsGuide: React.FC<Props> = ({ counts, canAddNote, onJump }) => {
  const { t } = useTranslation(['workspace']);
  const present = ITEMS.filter(i => (counts[i.key] ?? 0) > 0);
  const addNote = canAddNote && !(counts.pageNotes ?? 0);
  if (present.length === 0 && !addNote) return null;

  // Võtmed sõnasõnaliselt — i18n valvur otsib neid lähtekoodist.
  const label: Record<GuideKey, string> = {
    toc: t('info.guide.toc'), workSets: t('info.guide.workSets'), workTags: t('info.guide.workTags'),
    pageTags: t('info.guide.pageTags'), textAnnotations: t('info.guide.textAnnotations'),
    pageNotes: t('info.guide.pageNotes'), addNote: t('info.guide.addNote'),
  };

  return (
    <nav aria-label={t('info.guide.label')} className="flex flex-wrap gap-1.5 -mt-1 mb-4">
      {present.map(({ key, icon: Icon, tone }) => (
        <button key={key} type="button" data-guide={key} onClick={() => onJump(key)}
          className={key === 'pageNotes' ? warm : calm}>
          <Icon size={12} aria-hidden />
          {label[key]}
          <span className={`font-medium ${tone}`}>{counts[key]}</span>
        </button>
      ))}
      {addNote && (
        <button type="button" data-guide="addNote" onClick={() => onJump('addNote')}
          className={`${calm} border-dashed text-gray-500`}>
          <MessageSquarePlus size={12} aria-hidden />
          {label.addNote}
        </button>
      )}
    </nav>
  );
};

export default AnnotationsGuide;
