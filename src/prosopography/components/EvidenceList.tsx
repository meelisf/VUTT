import { X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import type { EnrichmentEvidence } from '../services/prosopographyService';
import { evidenceRef } from '../utils/evidenceRef';

interface Props {
  evidence: EnrichmentEvidence[];
  titleOf: (workId: string) => string | undefined;
  /** Isikuvormis saab tõendi eemaldada; muutmist ei ole (spekk 2026-09-28). */
  onRemove?: (index: number) => void;
}

export default function EvidenceList({ evidence, titleOf, onRemove }: Props) {
  const { t } = useTranslation('prosopography');
  return (
    <ul className="space-y-1 text-xs text-gray-600">
      {evidence.map((source, index) => {
        const ref = evidenceRef(source, titleOf, t('agentEnrichment.page'));
        return (
          <li key={index} className="flex items-start gap-2">
            <span className="flex-1 min-w-0">
              {ref.href && !ref.external
                ? <Link className="text-blue-700 underline" to={ref.href}>{ref.title}</Link>
                : ref.href
                  ? <a className="text-blue-700 underline" href={ref.href} target="_blank" rel="noopener noreferrer">{ref.title}</a>
                  : ref.title}
              {ref.locator && `, ${ref.locator}`}
              {ref.quote && <> — <q className="italic text-gray-500">{ref.quote}</q></>}
            </span>
            {onRemove && (
              <button type="button" onClick={() => onRemove(index)} aria-label={t('evidenceRemove')}
                title={t('evidenceRemove')}
                className="text-gray-400 hover:text-red-500 shrink-0"><X size={12} /></button>
            )}
          </li>
        );
      })}
    </ul>
  );
}
