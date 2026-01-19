import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Languages } from 'lucide-react';

interface LanguageSwitcherProps {
  className?: string;
}

const LanguageSwitcher: React.FC<LanguageSwitcherProps> = ({ className = '' }) => {
  const { t, i18n } = useTranslation();
  const [isOpen, setIsOpen] = useState(false);

  const languages = [
    { code: 'et', name: 'Eesti', flag: '🇪🇪' },
    { code: 'en', name: 'English', flag: '🇬🇧' }
  ];

  const currentLang = languages.find(l => l.code === i18n.language) || languages[0];

  const changeLanguage = (langCode: string) => {
    i18n.changeLanguage(langCode);
    document.documentElement.lang = langCode;
    setIsOpen(false);
  };

  return (
    <div className={`relative ${className}`}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center justify-center p-2 text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
        aria-label={t('common:language.select')}
        title={currentLang.name}
      >
        <Languages size={18} />
      </button>

      {isOpen && (
        <>
          <div className="fixed inset-0 z-[100]" onClick={() => setIsOpen(false)} />
          <div className="absolute right-0 top-full mt-1 bg-white rounded-lg shadow-lg border border-gray-200 py-1 min-w-32 z-[110]">
            {languages.map(lang => (
              <button
                key={lang.code}
                onClick={() => changeLanguage(lang.code)}
                className={`flex items-center gap-2 px-3 py-2 text-sm w-full text-left transition-colors ${
                  i18n.language === lang.code 
                    ? 'bg-primary-50 text-primary-700 font-medium' 
                    : 'text-gray-700 hover:bg-gray-100'
                }`}
              >
                <span>{lang.flag}</span>
                <span>{lang.name}</span>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
};

export default LanguageSwitcher;
