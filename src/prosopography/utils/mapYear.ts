export const DEFAULT_MAP_YEAR = 1650;

interface MapYearFilters {
  year_from?: number;
  year_to?: number;
  imm_year_from?: number;
  imm_year_to?: number;
}

/**
 * Leiab isikufiltrite põhjal ajaloolise kaardi lähteaasta.
 * Uus üldine aastafilter on eelistatud vanale immatrikuleerimisaasta filtrile.
 */
export function deriveMapYear(filters: MapYearFilters): number {
  const from = filters.year_from ?? filters.imm_year_from;
  const to = filters.year_to ?? filters.imm_year_to;

  if (from !== undefined && to !== undefined) return Math.round((from + to) / 2);
  return from ?? to ?? DEFAULT_MAP_YEAR;
}
