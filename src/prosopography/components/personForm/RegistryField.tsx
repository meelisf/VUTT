// src/prosopography/components/personForm/RegistryField.tsx
/**
 * Ameti või asutuse väli isikuvormis (ADR 0059): üks väli kahe asja jaoks.
 * Väli ise = allika sõnastus („Lyz. Riga"); kiip selle all = registrikirje, mis see on.
 * Trükkides tulevad esimesena registri vasted (nimevariantide järgi), siis
 * Wikidata/vaba tekst nagu varem. Registrikirjeid lisab ainult admin.
 * Sidumata väli on nähtavalt sidumata: Q-kood üksi näeb välja nagu seotud kirje,
 * aga elukäigu kaart leiab asutuse koha ainult registrivõtme kaudu.
 */
import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Landmark, Link2, Plus, X } from 'lucide-react';
import EntityPicker from '../../../components/EntityPicker';
import type { LinkedEntity } from '../../../types/LinkedEntity';
import { matchRegistry, registryLabel, registrySuggestion, type RegistryEntryLike, type RegistryHit } from '../../utils/registryMatch';
import { formatYears } from '../../utils/registryCreate';
import { registryChanged } from '../../hooks/useRegistry';
import RegistryEntryModal from '../RegistryEntryModal';

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
  /** Admin: sidumata väljal „Lisa registrisse" (aken, otsing algab välja tekstist). */
  createKind?: 'occupation' | 'institution';
  token?: string;
  /** Sidumata sildi lisalause, nt asutusel „kaardile ei jõua". */
  unlinkedNote?: string;
}

const RegistryField: React.FC<Props> = ({ registry, placeholder, lang, localSuggestions, value, registryKey,
  onChange, onPick, onUnlink, disabled, createKind, token, unlinkedNote }) => {
  const { t } = useTranslation('prosopography');
  const leading = (query: string) => matchRegistry(registry, query, lang).map(hit => {
    const extra = [hit.matched !== hit.label ? hit.matched : null, hit.entry.id,
      formatYears(hit.entry.active_from, hit.entry.active_to), hit.entry.place_key].filter(Boolean).join(' · ');
    return { key: hit.key, label: hit.label, id: hit.entry.id,
             description: `${t('form.registry.badge')}${extra ? ` · ${extra}` : ''}` };
  });
  const entry = registryKey ? registry[registryKey] : undefined;
  // Seotud väljal näitab kast allika sõnastust, registri nimi on kiibis. `labels` tuleb
  // registrist ja EntityPicker eelistaks seda — „Rostocki Ülikool" muutus „Rostock"-iks.
  const shown = registryKey && value?.label
    ? { ...value, labels: { ...(value.labels ?? {}), [lang.split('-')[0]]: value.label } } : value;
  const source = value?.label?.trim() || '';
  const unlinked = !registryKey && !!(source || value?.id);
  const suggestion = unlinked ? registrySuggestion(registry, value?.id, source, lang) : null;
  const [creating, setCreating] = useState(false);
  const canCreate = !!createKind && !!token && unlinked && !suggestion;
  const pickKey = (key: string, picked: RegistryEntryLike) =>
    onPick({ key, entry: picked, label: registryLabel(picked, key, lang), matched: source }, source);
  return (
    <div>
      <EntityPicker placeholder={placeholder} type="topic" value={shown} onChange={onChange} lang={lang}
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
      {unlinked && (
        <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
          <span className="rounded border border-amber-200 bg-amber-50 px-2 py-0.5 text-amber-800">
            {t('form.registry.unlinked')}{unlinkedNote ? ` — ${unlinkedNote}` : ''}
          </span>
          {suggestion && !disabled && (
            <button type="button" onClick={() => onPick(suggestion, source)}
              className="inline-flex items-center gap-1 rounded border border-teal-200 px-2 py-0.5 text-teal-800 hover:bg-teal-50">
              <Link2 size={11} />
              {t('form.registry.linkTo', { label: suggestion.label })}
            </button>
          )}
          {canCreate && !disabled && (
            <button type="button" onClick={() => setCreating(true)}
              className="inline-flex items-center gap-1 text-primary-700 hover:underline">
              <Plus size={11} />
              {t('form.registry.create')}
            </button>
          )}
        </div>
      )}
      {creating && createKind && token && (
        <RegistryEntryModal kind={createKind} initialQuery={source} registry={registry} token={token} lang={lang}
          onClose={() => setCreating(false)}
          onCreated={(key, created) => { setCreating(false); registryChanged(createKind); pickKey(key, created); }}
          onUseExisting={key => { setCreating(false); if (registry[key]) pickKey(key, registry[key]); }} />
      )}
    </div>
  );
};

export default RegistryField;
