/**
 * Valiku kuvand vaadetele (#354): silt + värviklassid ühest kohast.
 *
 * Vt `src/contexts/selectionDisplay.ts` — seal on ka põhjus, miks see olemas on.
 */
import { useTranslation } from 'react-i18next';
import { useCollection } from '../contexts/CollectionContext';
import { selectionDisplay, SelectionDisplay } from '../contexts/selectionDisplay';
import { getCollectionColorClasses } from '../services/collectionService';
import { getLangCode } from '../utils/getLangCode';

export interface SelectionLabel {
  display: SelectionDisplay;
  /** Valmis silt — sh „ei leitud", kui kogu ei ole kutsujale nähtav. */
  label: string;
  isWorkSet: boolean;
  /** Värviklassid; töökollektsioonil ei ole oma värvi, seega vaikepalett. */
  colorClasses: ReturnType<typeof getCollectionColorClasses> | null;
}

export function useSelectionLabel(): SelectionLabel {
  const { t, i18n } = useTranslation(['common']);
  const { selection, collections, workSets } = useCollection();
  const lang = getLangCode(i18n.language);
  const display = selectionDisplay(selection, collections, workSets, lang);

  if (display.kind === 'all') {
    return {
      display,
      label: t('common:collections.all', 'Kõik tööd'),
      isWorkSet: false,
      colorClasses: null,
    };
  }
  if (display.kind === 'collection') {
    return {
      display,
      label: display.name,
      isWorkSet: false,
      colorClasses: getCollectionColorClasses(collections[display.id]),
    };
  }
  return {
    display,
    label: display.name
      ?? t('common:workSets.notFound', 'Töökollektsiooni ei leitud või puudub ligipääs'),
    isWorkSet: true,
    colorClasses: null,
  };
}
