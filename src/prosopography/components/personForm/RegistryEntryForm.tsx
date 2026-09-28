import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import EntityPicker from '../../../components/EntityPicker';
import type { LinkedEntity } from '../../../types/LinkedEntity';
import {
  saveRegistryEntry, type InstitutionRegistryEntry, type OccupationRegistryEntry,
} from '../../services/prosopographyService';

type Entry = OccupationRegistryEntry | InstitutionRegistryEntry;

interface Props {
  kind: 'occupation' | 'institution';
  /** Olemasoleva kirje muutmisel võti + kirje; uue puhul undefined. */
  existing?: { key: string; entry: Entry };
  /** Allika sõnastus — uue kirje nimevariandi eeltäide. */
  sourceWording: string;
  /** Registris juba olevad võtmed: uus kirje ei tohi kogemata olemasolevat üle kirjutada. */
  takenKeys: (key: string) => Promise<boolean>;
  token: string;
  onSaved: (key: string, entry: Entry) => void;
  onCancel: () => void;
}

/** Nimest püsivõti: diakriitikud maha, muu kui a–z0–9 → sidekriips. */
export const registryKeyFrom = (label: string) => label.normalize('NFKD')
  .replace(/[̀-ͯ]/g, '').toLowerCase()
  .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 100);

/**
 * Registrikirje loomine/muutmine otse ettepaneku realt (ADR 0059: registrikirje on
 * admini eraldi toiming — siin sama `PUT /registries`, lihtsalt õiges kohas).
 * Isikufakti sõnastus jääb kaardile; siin määratakse normaliseeritud nimi.
 */
export default function RegistryEntryForm({ kind, existing, sourceWording, takenKeys, token, onSaved, onCancel }: Props) {
  const { t, i18n } = useTranslation('prosopography');
  const tr = (key: string) => t(`agentEnrichment.registryForm.${key}`);
  const entry = existing?.entry;
  const [key, setKey] = useState(existing?.key ?? '');
  const [keyTouched, setKeyTouched] = useState(Boolean(existing));
  const [labelEt, setLabelEt] = useState(entry?.labels.et ?? '');
  const [labelEn, setLabelEn] = useState(entry?.labels.en ?? '');
  const [qid, setQid] = useState(entry?.id ?? '');
  const [variants, setVariants] = useState((entry?.variants ?? [sourceWording.trim()].filter(Boolean)).join('\n'));
  const [type, setType] = useState((entry as InstitutionRegistryEntry | undefined)?.type ?? '');
  const [placeKey, setPlaceKey] = useState((entry as InstitutionRegistryEntry | undefined)?.place_key ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const onLabelEt = (value: string) => {
    setLabelEt(value);
    if (!keyTouched) setKey(registryKeyFrom(value));
  };

  // Wikidata valik täidab Q-koodi ja sildid nagu teisteski lisamisvormides;
  // käsitsi kirjutatud tekst (source 'manual') Q-koodi ei anna ja jäetakse kõrvale.
  const onWikidata = (entity: LinkedEntity | null) => {
    if (!entity) { setQid(''); return; }
    if (entity.source !== 'wikidata' || !entity.id) return;
    setQid(entity.id);
    const et = entity.labels?.et?.trim(), en = entity.labels?.en?.trim();
    if (et) setLabelEt(et);
    if (en) setLabelEn(en);
    if (!keyTouched && (et || en)) setKey(registryKeyFrom(et || en || ''));
  };
  const lang = i18n.language.slice(0, 2);

  const save = async () => {
    setBusy(true); setError('');
    try {
      if (!existing && await takenKeys(key)) { setError(tr('keyExists')); return; }
      const labels = Object.fromEntries(Object.entries({ et: labelEt, en: labelEn })
        .filter(([, value]) => value.trim()));
      // Olemasoleva kirje välju, mida see vorm ei näita (notes, place_periods), ei pühita.
      const value = {
        ...entry, id: qid.trim() || null, labels,
        variants: variants.split('\n').map(v => v.trim()).filter(Boolean),
        ...(kind === 'institution' ? { type: type.trim(), place_key: placeKey.trim() || null } : {}),
      } as Entry;
      onSaved(key, await saveRegistryEntry(kind, key, value, token));
    } catch (err) { setError((err as Error).message); }
    finally { setBusy(false); }
  };

  const input = 'mt-0.5 block w-full rounded border px-2 py-1';
  return <div className="space-y-2 rounded border border-green-200 bg-green-50/40 p-2 text-xs">
    <p className="text-gray-600">{tr('help')}</p>
    <div>{tr('wikidata')}
      <EntityPicker type="topic" lang={lang} placeholder={sourceWording}
        value={qid ? { id: qid, label: labelEt || labelEn || qid, source: 'wikidata',
          labels: { ...(labelEt ? { et: labelEt } : {}), ...(labelEn ? { en: labelEn } : {}) } } : null}
        onChange={onWikidata} />
    </div>
    <label className="block">{tr('labelEt')}
      <input value={labelEt} onChange={e => onLabelEt(e.target.value)} className={input} />
    </label>
    <label className="block">{tr('labelEn')}
      <input value={labelEn} onChange={e => setLabelEn(e.target.value)} className={input} />
    </label>
    <label className="block">{tr('key')}
      <input value={key} disabled={Boolean(existing)}
        onChange={e => { setKeyTouched(true); setKey(e.target.value); }}
        className={`${input} font-mono disabled:bg-gray-100`} />
    </label>
    <label className="block">{tr('variants')}
      <textarea value={variants} onChange={e => setVariants(e.target.value)} rows={2} className={input} />
    </label>
    <label className="block">{tr('qid')}
      <input value={qid} onChange={e => setQid(e.target.value)} className={`${input} font-mono`} />
    </label>
    {kind === 'institution' && <>
      <label className="block">{tr('type')}
        <input value={type} onChange={e => setType(e.target.value)} className={input} />
      </label>
      <label className="block">{tr('placeKey')}
        <input value={placeKey} onChange={e => setPlaceKey(e.target.value)} className={`${input} font-mono`} />
      </label>
    </>}
    {error && <p role="alert" className="text-red-700">{error}</p>}
    <div className="flex gap-2">
      <button type="button" onClick={() => void save()}
        disabled={busy || !key.trim() || !labelEt.trim() || (kind === 'institution' && !type.trim())}
        className="rounded bg-green-700 px-2 py-1 text-white disabled:opacity-50">{tr('save')}</button>
      <button type="button" onClick={onCancel} disabled={busy}
        className="rounded border px-2 py-1">{tr('cancel')}</button>
    </div>
  </div>;
}
