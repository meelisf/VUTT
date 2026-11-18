/** Isikukaardi väljade realiigid agendi ettepanekus lisaks ametile ja haridusele (#834). */
export const FIELD_KINDS = ['birth', 'death', 'origin', 'gender', 'biography',
  'floruit', 'alias', 'name', 'status', 'confession', 'relation', 'identifier'] as const;
export type EnrichmentFieldKind = typeof FIELD_KINDS[number];
