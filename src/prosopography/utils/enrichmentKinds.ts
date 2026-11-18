/** Isikukaardi väljade realiigid agendi ettepanekus lisaks ametile ja haridusele (#834). */
export const FIELD_KINDS = ['birth', 'death', 'origin', 'gender', 'biography'] as const;
export type EnrichmentFieldKind = typeof FIELD_KINDS[number];
