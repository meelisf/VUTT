import React from 'react';
import { useTranslation } from 'react-i18next';
import { Star } from 'lucide-react';

interface FavoriteStarProps {
  active: boolean;
  onToggle: () => void;
  disabled?: boolean;
}

/** Lemmiku tärn kogu-valija real. Klikk ei vali rida (`stopPropagation`). */
const FavoriteStar: React.FC<FavoriteStarProps> = ({ active, onToggle, disabled }) => {
  const { t } = useTranslation(['common']);
  const label = active
    ? t('workSets.removeFavorite', 'Eemalda lemmikutest')
    : t('workSets.addFavorite', 'Lisa lemmikuks');
  return (
    <button
      type="button"
      onClick={(e) => { e.stopPropagation(); onToggle(); }}
      disabled={disabled}
      title={label}
      aria-label={label}
      aria-pressed={active}
      className="shrink-0 w-6 h-6 flex items-center justify-center rounded hover:bg-gray-200 disabled:opacity-50 transition-colors"
    >
      <Star
        size={15}
        className={active ? 'text-amber-500 fill-amber-400' : 'text-gray-300 hover:text-gray-500'}
      />
    </button>
  );
};

export default FavoriteStar;
