import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';

/**
 * Pealkirja tõlge, originaal ja tekkeviis (ADR 0064) — ühine teose metaandmete
 * vormile ja upload'i sammu 3 vormile.
 *
 * Enamikul trükistel neid välju vaja ei ole, seega on lahtrid kokku klapitud,
 * kuni pealkiri on märgitud koostatuks VÕI mõnes lahtris on juba väärtus
 * (olemasolevat sisu ei peideta kunagi).
 */
interface Props {
  titleEn: string;
  titleOriginal: string;
  titleDevised: boolean;
  onChange: (patch: { title_en?: string; title_original?: string; title_devised?: boolean }) => void;
  textareaClassName: string;
}

const TitleVariantsFields: React.FC<Props> = ({ titleEn, titleOriginal, titleDevised, onChange, textareaClassName }) => {
  const { t } = useTranslation(['workspace']);
  const [expanded, setExpanded] = useState(false);
  const open = expanded || titleDevised || Boolean(titleEn.trim() || titleOriginal.trim());

  return (
    <div className="space-y-2">
      <label className="flex items-start gap-2 text-sm text-gray-700">
        <input
          type="checkbox"
          className="mt-0.5"
          checked={titleDevised}
          onChange={e => onChange({ title_devised: e.target.checked })}
        />
        <span>
          {t('workspace:metadata.titleDevised')}
          <span className="block text-xs text-gray-500">{t('workspace:metadata.titleDevisedHint')}</span>
        </span>
      </label>

      {open ? (
        <>
          <div>
            <label className="block text-xs font-bold text-gray-500 uppercase mb-1">{t('workspace:metadata.titleEn')}</label>
            <textarea
              className={textareaClassName}
              rows={2}
              value={titleEn}
              onChange={e => onChange({ title_en: e.target.value })}
            />
          </div>
          <div>
            <label className="block text-xs font-bold text-gray-500 uppercase mb-1">{t('workspace:metadata.titleOriginal')}</label>
            <textarea
              className={textareaClassName}
              rows={2}
              placeholder={t('workspace:metadata.titleOriginalHint')}
              value={titleOriginal}
              onChange={e => onChange({ title_original: e.target.value })}
            />
          </div>
        </>
      ) : (
        <button
          type="button"
          className="text-xs text-primary-700 hover:underline"
          onClick={() => setExpanded(true)}
        >
          + {t('workspace:metadata.titleVariantsAdd')}
        </button>
      )}
    </div>
  );
};

export default TitleVariantsFields;
