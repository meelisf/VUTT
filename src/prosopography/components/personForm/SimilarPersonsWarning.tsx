import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Users, ExternalLink } from 'lucide-react';
import { listPersons } from '../../services/prosopographyService';
import type { ProsopoIndexEntry } from '../../types';

/** Nimi peab olema vähemalt nii pikk, enne kui otsime. Kaks tähte annab
 *  praktiliselt kogu korpuse ja vasteplokk kaotaks mõtte. */
const MIN_LENGTH = 3;
const DEBOUNCE_MS = 400;
const MAX_MATCHES = 5;

interface Props {
  /** Nimi, mille kasutaja on sisestanud (`name_label`). */
  name: string;
  token?: string;
  /** Kasutaja on kinnitanud, et tegu on teise inimesega. */
  dismissed: boolean;
  onDismiss: () => void;
  /** Vastete arv antakse üles, et salvestusvärav saaks teda lugeda. */
  onMatchesChange: (count: number) => void;
}

/**
 * Hoiatab uue isiku loomisel sarnase nimega olemasolevate kaartide eest (#240).
 *
 * **Otsib ALATI kogu VUTT-ist** — aktiivne kollektsioon siia ei puutu ja seda
 * ei muudeta. Just kollektsioonipiirang oligi topeltloomise põhjus: kasutaja
 * ei leidnud isikut oma kogu piires ja lõi ta uuesti. Sidumist ei tohi piirata
 * sellega, kas kirje on juba praeguse kollektsiooniga seotud. Ligipääsuõigusi
 * rakendab server.
 *
 * Nime sarnasus EI OLE loomiskeeld: ploki saab kinnitusega kõrvale lükata.
 */
const SimilarPersonsWarning: React.FC<Props> = ({
  name, token, dismissed, onDismiss, onMatchesChange,
}) => {
  const { t } = useTranslation(['prosopography', 'common']);
  const [matches, setMatches] = useState<ProsopoIndexEntry[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const trimmed = name.trim();
    if (trimmed.length < MIN_LENGTH) {
      setMatches([]);
      onMatchesChange(0);
      return;
    }
    let cancelled = false;
    setLoading(true);
    const timer = setTimeout(() => {
      // Ei `collection`-it ega `work_set`-i: ulatus on kogu VUTT.
      listPersons({ q: trimmed, limit: MAX_MATCHES }, token)
        .then(res => {
          if (cancelled) return;
          const hits = res.results.filter(p => p.record_status !== 'tombstone');
          setMatches(hits);
          onMatchesChange(hits.length);
        })
        .catch(() => {
          if (cancelled) return;
          // Vaikne ebaõnnestumine on siin õige: hoiatus on abi, mitte värav.
          // Kättesaamatu otsing ei tohi takistada isiku loomist.
          setMatches([]);
          onMatchesChange(0);
        })
        .finally(() => { if (!cancelled) setLoading(false); });
    }, DEBOUNCE_MS);
    return () => { cancelled = true; clearTimeout(timer); setLoading(false); };
  }, [name, token, onMatchesChange]);

  if (dismissed || loading || matches.length === 0) return null;

  const years = (p: ProsopoIndexEntry) => {
    if (!p.birth_year && !p.death_year) return null;
    return `${p.birth_year ?? '?'}–${p.death_year ?? '?'}`;
  };

  return (
    <div className="mt-2 rounded border border-amber-200 bg-amber-50/60 p-3">
      <div className="flex items-center gap-1.5 text-xs font-medium text-amber-800 mb-2">
        <Users size={13} />
        {t('similar.title', 'Sarnased isikud kogu VUTT-ist')}
      </div>

      <ul className="space-y-1.5">
        {matches.map(p => (
          <li key={p.id} className="flex items-center justify-between gap-3 text-sm">
            <span className="min-w-0">
              <span className="font-medium text-gray-800">{p.label}</span>
              {years(p) && <span className="ml-1.5 text-gray-500">{years(p)}</span>}
              {p.work_count > 0 && (
                <span className="ml-1.5 text-xs text-gray-500">
                  {t('similar.workCount', '{{count}} teost', { count: p.work_count })}
                </span>
              )}
            </span>
            {/* Uus tab, et vormi sisestatud andmed püsiksid. */}
            <a
              href={`/persons/${p.id}`}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1 shrink-0 text-xs text-primary-700 hover:text-primary-800 hover:underline"
            >
              {t('similar.view', 'Vaata isikut')}
              <ExternalLink size={11} />
            </a>
          </li>
        ))}
      </ul>

      <button
        type="button"
        onClick={onDismiss}
        className="mt-2.5 text-xs text-amber-800 underline hover:text-amber-900"
      >
        {t('similar.distinct', 'See on teine inimene — jätkan uue isikuga')}
      </button>
    </div>
  );
};

export default SimilarPersonsWarning;
