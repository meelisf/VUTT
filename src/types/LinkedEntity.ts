/**
 * Linked Data Entity structure for V3 Metadata.
 * Used for fields like location, publisher, genre, and keywords.
 */
export interface LinkedEntity {
  id: string | null;       // Wikidata ID (e.g., "Q13972"), VIAF, AA:123, or null for manual entries
  label: string;           // Primary label for display (e.g., "Tartu")
  source: 'wikidata' | 'viaf' | 'album_academicum' | 'manual';
  labels?: {               // Multilingual support
    et?: string;
    en?: string;
    la?: string;
    de?: string;
    [key: string]: string | undefined;
  };
}
