/**
 * `/persons/new` algvaade (PR 3, task 7): isikupaneel renderdub lehel inline
 * (mitte külgpaneelina) — kasutaja otsib, valib olemasoleva või loob uue.
 * „Täida vorm käsitsi" jätab otsingu vahele ja avab `PersonEditPage`'i tühja vormi.
 */
import React from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import PersonAddPanel from '../components/PersonAddPanel';

interface NewPersonStartProps {
  initialQuery: string;
  token: string;
  lang: 'et' | 'en';
  onManual: () => void;
}

const NewPersonStart: React.FC<NewPersonStartProps> = ({ initialQuery, token, lang, onManual }) => {
  const { t } = useTranslation(['prosopography']);
  const navigate = useNavigate();

  return (
    <div>
      <PersonAddPanel
        inline
        initialQuery={initialQuery}
        token={token}
        lang={lang}
        onDone={({ id, created }) => {
          // Loodud kaardil käib taustarikastus — kasutaja jätkab muutmisvaates.
          // Valitud olemasoleval kaardil on kõik juba täidetud — profiilivaade piisab.
          navigate(created ? `/persons/${encodeURIComponent(id)}/edit` : `/persons/${encodeURIComponent(id)}`);
        }}
        onClose={() => {}}
      />
      <button
        type="button"
        onClick={onManual}
        className="mt-3 text-xs font-medium text-primary-700 hover:text-primary-900 hover:underline"
      >
        {t('panel.manualForm')}
      </button>
    </div>
  );
};

export default NewPersonStart;
