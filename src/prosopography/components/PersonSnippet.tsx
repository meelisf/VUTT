import React from 'react';
import { useTranslation } from 'react-i18next';
import type { ProsopoIndexEntry } from '../types';
import { pickSnippet, snippetBadgeKey, type BioLang } from '../utils/biographyChain';

interface Props { entry: ProsopoIndexEntry; lang: BioLang }

/** Nimekirja katke + aus märge selle kohta, MIS allikas see on. */
const PersonSnippet: React.FC<Props> = ({ entry, lang }) => {
  const { t } = useTranslation(['prosopography']);
  const pick = pickSnippet(entry, lang);
  if (!pick) return null;
  const badge = snippetBadgeKey(pick);

  return (
    <p className="text-xs text-gray-500 italic leading-relaxed line-clamp-2 border-l-2 border-gray-200 pl-2 mt-2">
      {badge && (
        <span className="not-italic text-[10px] uppercase tracking-wide text-gray-400 mr-1">
          {t(badge)}
        </span>
      )}
      „{pick.text}…"
    </p>
  );
};

export default PersonSnippet;
