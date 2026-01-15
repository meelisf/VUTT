import React from 'react';
import { useTranslation } from 'react-i18next';
import { Languages } from 'lucide-react';

interface LanguageSwitcherProps {
  className?: string;
}

const LanguageSwitcher: React.FC<LanguageSwitcherProps> = ({ className = '' }) => {
  const { t, i18n } = useTranslation();

  const languages = [
    { code: 'et', name: 'Eesti' },
    { code: 'en', name: 'English' }
  ];

  const currentLang = languages.find(l => l.code === i18n.language) || languages[0];
  const nextLang = i18n.language === 'et' ? languages[1] : languages[0];

  const toggleLanguage = () => {
    i18n.changeLanguage(nextLang.code);
    // Uuenda ka HTML lang atribuut
    document.documentElement.lang = nextLang.code;
  };

  return (
    <button
      onClick={toggleLanguage}
      className={`flex items-center gap-2 px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-100 rounded-lg transition-colors ${className}`}
      aria-label={t('common:language.switchTo', { lang: nextLang.name })}
      title={t('common:language.switchTo', { lang: nextLang.name })}
    >
      <Languages size={18} />
      <span className="font-medium">{currentLang.name}</span>
    </button>
  );
};

export default LanguageSwitcher;
