/**
 * Seoste kaardi (`related_to`) ulatus.
 *
 * Seoste kaardi fookus on isik, mitte kogu: välislink isiku seostele peab
 * näitama kõiki seoseid sõltumata sellest, mis kogu vaatajal parasjagu valitud
 * on. Seepärast ei rakendu aktiivne valik (kollektsioon või töökollektsioon)
 * vaikimisi — ainult siis, kui URL kannab `related_scope=collection`.
 * Tavalisel kaardil (ilma `related_to`-ta) rakendub valik alati.
 */
export const RELATED_SCOPE_PARAM = 'related_scope';
export const RELATED_SCOPE_COLLECTION = 'collection';

export interface MapScope {
  collection?: string;
  work_set?: string;
}

export function relatedMapScope(
  relatedTo: string,
  relatedScope: string | null,
  scope: MapScope,
): { applied: boolean; filters: MapScope } {
  const applied = !relatedTo || relatedScope === RELATED_SCOPE_COLLECTION;
  return { applied, filters: applied ? scope : {} };
}
