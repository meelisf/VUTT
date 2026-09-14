/**
 * Parooli-taastamise lingi kast (#298, #318).
 *
 * Välja tõstetud, et sama kast töötaks nii kasutajate loendis kui detailis.
 * Saadetud kirja korral on link PEIDUS, mitte ära võetud: kiri võib maanduda
 * rämpsposti ja siis on link ainus tee.
 */
import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CheckCircle, Copy, Mail, X } from 'lucide-react';

export interface ResetResult {
  username: string;
  name: string;
  reset_url: string;
  mail_sent?: boolean;
  mail_error?: string | null;
}

interface Props {
  result: ResetResult;
  onClose: () => void;
}

const ResetPasswordResult: React.FC<Props> = ({ result, onClose }) => {
  const { t } = useTranslation(['admin', 'common']);
  const [linkCopied, setLinkCopied] = useState(false);
  // Saadetud kirja korral on taastelink peidus — see avab ta tagasi.
  const [showResetLink, setShowResetLink] = useState(false);

  const copyResetLink = () => {
    navigator.clipboard.writeText(`${window.location.origin}${result.reset_url}`);
    setLinkCopied(true);
    setTimeout(() => setLinkCopied(false), 2000);
  };

  return (
    <div className="mb-4 p-4 bg-green-50 border border-green-200 rounded-lg">
      <div className="flex items-start gap-3">
        <CheckCircle className="w-5 h-5 text-green-600 flex-shrink-0 mt-0.5" />
        <div className="flex-1">
          <h3 className="font-medium text-green-800">{t('users.resetLinkGenerated')}</h3>
          <p className="text-sm text-green-700 mt-1">
            {result.name} (<span className="font-mono">{result.username}</span>)
          </p>
          <p className="text-xs text-green-700 mt-1">{t('users.resetLinkHint')}</p>
          {/* Saatmise tulemus. Link ülal kehtib kõigil kolmel juhul —
              teade puudutab ainult edasitoimetamist. */}
          {result.mail_sent === true && (
            <p className="text-xs text-green-700 mt-1 flex items-center gap-1">
              <Mail size={13} />
              {t('mail.sentToUser')}
            </p>
          )}
          {result.mail_sent === false && (
            <p className="text-xs text-amber-700 mt-1">
              {t('mail.failed', { reason: result.mail_error || '—' })}
            </p>
          )}
          {/* Saadetud kirja korral on link peidus, mitte ära võetud:
              kiri võib maanduda rämpsposti (#298). */}
          {result.mail_sent === true && !showResetLink && (
            <button
              onClick={() => setShowResetLink(true)}
              className="mt-2 text-xs text-green-800 underline hover:text-green-900"
            >
              {t('mail.showLink')}
            </button>
          )}
          {(result.mail_sent !== true || showResetLink) && (
          <div className="mt-3 flex items-center gap-2">
            <code className="flex-1 bg-white px-3 py-2 rounded border border-green-300 text-sm text-gray-800 overflow-x-auto">
              {window.location.origin}{result.reset_url}
            </code>
            <button
              onClick={copyResetLink}
              className="px-3 py-2 bg-green-600 text-white rounded hover:bg-green-700 transition-colors flex items-center gap-1 whitespace-nowrap"
            >
              {linkCopied ? <CheckCircle size={16} /> : <Copy size={16} />}
              {linkCopied ? t('users.linkCopied') : t('users.copyLink')}
            </button>
          </div>
          )}
        </div>
        <button
          onClick={onClose}
          className="text-green-600 hover:text-green-800 flex-shrink-0"
          title={t('common:buttons.close')}
          aria-label={t('common:buttons.close')}
        >
          <X size={18} />
        </button>
      </div>
    </div>
  );
};

export default ResetPasswordResult;
