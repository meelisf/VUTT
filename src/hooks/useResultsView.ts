import type { ResultsPage, ResultsView } from '../contexts/UserContext';
import { usePagePreference } from './usePagePreference';

const parseView = (raw: string | null): ResultsView | null => (raw === 'list' || raw === 'cards' ? raw : null);
const parseOpen = (raw: string | null): boolean | null => (raw === 'true' ? true : raw === 'false' ? false : null);

/** Kaardid ↔ loend lehe kaupa (#587). */
export const useResultsView = (page: ResultsPage) =>
  usePagePreference('results_view', page, parseView, 'cards');

/** Filtrite külgriba lahti/kinni lehe kaupa (#587); vaikimisi kinni. */
export const useFilterSidebarOpen = (page: ResultsPage) =>
  usePagePreference('filter_sidebar', page, parseOpen, false);
