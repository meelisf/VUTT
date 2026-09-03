import React, { useState } from 'react';
import { ChevronDown, Loader2, AlertTriangle, Check } from 'lucide-react';
import type { AdaLookupResult, AdaVormiVali } from '../types';

interface Props {
  handle: string;
  setHandle: (v: string) => void;
  laeb: boolean;
  viga: string;
  tulemus: AdaLookupResult | null;
  onTomba: () => void;
  /** Väljad, mille ADA väärtus erineb admini käsitsi sisestatust — üks-klõps ülekirjutus. */
  ulekirjutatavad: Array<{ vali: AdaVormiVali; adaVaartus: string }>;
  onTakeAda: (vali: AdaVormiVali) => void;
  t: (key: string, options?: Record<string, unknown>) => string;
}

function mb(baite: number): string {
  return `${Math.round(baite / 1024 / 1024)} MB`;
}

/** Väljanimi ülekirjutus-kaardil — taaskasutab step1 väljasilte, kui olemas. */
function valiSilt(vali: AdaVormiVali, t: Props['t']): string {
  if (vali === 'title') return t('step1.titleLabel');
  if (vali === 'year') return t('step1.yearLabel');
  return vali;
}

const AdaImportBar: React.FC<Props> = ({
  handle, setHandle, laeb, viga, tulemus, onTomba, ulekirjutatavad, onTakeAda, t,
}) => {
  const [avatud, setAvatud] = useState(false);
  return (
    <div className="mb-6 border border-gray-200 rounded-lg overflow-hidden">
      <div className="px-4 py-2.5 bg-gray-50 border-b border-gray-200">
        <span className="text-xs font-semibold text-gray-700">{t('ada.title')}</span>
      </div>
      <div className="p-3">
        <div className="flex gap-2">
          <input
            type="text"
            value={handle}
            onChange={(e) => setHandle(e.target.value)}
            placeholder={t('ada.placeholder')}
            className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm
                       focus:outline-none focus:ring-2 focus:ring-primary-500"
          />
          <button
            type="button"
            onClick={onTomba}
            disabled={laeb || !handle.trim()}
            className="px-4 py-2 text-sm rounded-lg bg-primary-600 text-white
                       disabled:opacity-50 flex items-center gap-2"
          >
            {laeb && <Loader2 size={14} className="animate-spin" />}
            {t('ada.fetch')}
          </button>
        </div>
        <p className="text-xs text-gray-500 mt-1">{t('ada.hint')}</p>

        {viga && (
          <div className="mt-3 p-3 bg-red-50 border border-red-200 rounded-lg
                          text-sm text-red-700">{viga}</div>
        )}

        {tulemus && (
          <div className="mt-3 text-sm">
            <div className="flex items-start gap-2">
              <Check size={14} className="text-green-600 mt-0.5 shrink-0" />
              <span className="font-medium text-gray-900">{tulemus.meta.title}</span>
            </div>
            <div className="text-xs text-gray-600 mt-1">
              {[
                tulemus.meta.creators.map((c) => c.label).join('; '),
                tulemus.meta.year,
                tulemus.meta.archive_refs.map((a) => `${a.archive_id} ${a.reference}`).join('; '),
              ].filter(Boolean).join(' · ')}
            </div>
            <button
              type="button"
              onClick={() => setAvatud(!avatud)}
              className="mt-2 text-xs text-primary-600 flex items-center gap-1"
            >
              {t('ada.fileCount', { count: tulemus.failid.length, size: mb(tulemus.kogu_baite) })}
              <ChevronDown size={12} className={avatud ? 'rotate-180' : ''} />
            </button>
            {avatud && (
              <ol className="mt-2 max-h-52 overflow-y-auto text-xs text-gray-700
                             border border-gray-200 rounded-lg divide-y">
                {tulemus.failid.map((f, i) => (
                  <li key={f.bitstream_uuid} className="px-2 py-1 flex items-center gap-2">
                    <span className="text-gray-400 w-8 text-right">{i + 1}.</span>
                    <span className="flex-1">{f.name}</span>
                    {f.tapsus > 0 && (
                      <span className="text-amber-600 flex items-center gap-1">
                        <AlertTriangle size={11} />
                        {t(`ada.precision.${f.tapsus}`)}
                      </span>
                    )}
                  </li>
                ))}
              </ol>
            )}
            {tulemus.vahele_jaetud.length > 0 && (
              <p className="mt-2 text-xs text-amber-700">
                {t('ada.skipped', { files: tulemus.vahele_jaetud.join(', ') })}
              </p>
            )}

            {tulemus.olemasolev && (
              <div className="mt-3 p-3 bg-amber-50 border border-amber-200 rounded-lg text-sm">
                <span className="text-amber-800">
                  {t('ada.duplicate', { title: tulemus.olemasolev.title })}
                </span>
              </div>
            )}

            {/* Väljad, kus ADA väärtus erineb admini käsitsi sisestatust — ei kirjutata
                automaatselt üle, aga pakutakse ühekordset nuppu. */}
            {ulekirjutatavad.length > 0 && (
              <div className="mt-3 space-y-1.5">
                {ulekirjutatavad.map((u) => (
                  <div
                    key={u.vali}
                    className="flex items-center justify-between gap-2 text-xs
                               bg-amber-50 border border-amber-200 rounded-lg px-2 py-1.5"
                  >
                    <span className="text-amber-800 truncate">
                      <span className="font-medium">{valiSilt(u.vali, t)}:</span> {u.adaVaartus}
                    </span>
                    <button
                      type="button"
                      onClick={() => onTakeAda(u.vali)}
                      className="text-primary-600 font-medium shrink-0 hover:text-primary-800"
                    >
                      {t('ada.takeAda')}
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default AdaImportBar;
