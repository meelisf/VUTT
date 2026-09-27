// src/prosopography/components/personForm/RegistryField.tsx
/**
 * Ameti või asutuse väli isikuvormis (ADR 0059): üks väli kahe asja jaoks.
 * Väli ise = allika sõnastus („Lyz. Riga"); kiip selle all = registrikirje, mis see on.
 * Trükkides tulevad esimesena registri vasted (nimevariantide järgi), siis
 * Wikidata/vaba tekst nagu varem. Registrikirjeid lisab ainult admin.
 */
import React from 'react';
import { useTranslation } from 'react-i18next';
import { Landmark, X } from 'lucide-react';
import EntityPicker from '../../../components/EntityPicker';
import type { LinkedEntity } from '../../../types/LinkedEntity';
import { matchRegistry, registryLabel, type RegistryEntryLike, type RegistryHit } from '../../utils/registryMatch';

interface Props {
  registry: Record<string, RegistryEntryLike>;
  placeholder: string;
  lang: string;
  localSuggestions?: { label: string; id: string | null; labels?: Record<string, string> | null }[];
  /** EntityPickeri väärtus: allika sõnastus + Q-kood. */
  value: LinkedEntity | null;
  registryKey?: string;
  /** Vaba tekst / Wikidata valik — kutsuja nullib registrivõtme. */
  onChange: (value: LinkedEntity | null) => void;
  onPick: (hit: RegistryHit, typed: string) => void;
  onUnlink: () => void;
  disabled?: boolean;
}

const RegistryField: React.FC<Props> = ({ registry, placeholder, lang, localSuggestions, value, registryKey,
  onChange, onPick, onUnlink, disabled }) => {
  const { t } = useTranslation('prosopography');
  const leading = (query: string) => matchRegistry(registry, query, lang).map(hit => {
    const extra = [hit.matched !== hit.label ? hit.matched : null, hit.entry.id, hit.entry.place_key].filter(Boolean).join(' · ');
    return { key: hit.key, label: hit.label, id: hit.entry.id,
             description: `${t('form.registry.badge')}${extra ? ` · ${extra}` : ''}` };
  });
  const entry = registryKey ? registry[registryKey] : undefined;
  return (
    <div>
      <EntityPicker placeholder={placeholder} type="topic" value={value} onChange={onChange} lang={lang}
        localSuggestions={localSuggestions} leadingSuggestions={leading}
        onLeadingSelect={(item, typed) => {
          const picked = registry[item.key];
          if (picked) onPick({ key: item.key, entry: picked, label: registryLabel(picked, item.key, lang), matched: item.label }, typed);
        }} />
      {registryKey && (
        <div className="mt-1 inline-flex max-w-full items-center gap-1 rounded border border-teal-200 bg-teal-50 px-2 py-0.5 text-xs text-teal-800">
          <Landmark size={11} className="shrink-0" />
          <span className="truncate" title={registryKey}>
            {entry ? registryLabel(entry, registryKey, lang) : registryKey}
            {entry?.id ? ` · ${entry.id}` : ''}
          </span>
          {!disabled && (
            <button type="button" onClick={onUnlink} aria-label={t('form.registry.unlink')} title={t('form.registry.unlink')}
              className="ml-0.5 rounded p-0.5 text-teal-600 hover:bg-teal-100">
              <X size={11} />
            </button>
          )}
        </div>
      )}
    </div>
  );
};

export default RegistryField;
