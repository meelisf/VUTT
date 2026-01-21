import { LinkedEntity } from '../types/LinkedEntity';

/**
 * Capitalizes the first letter of a string, keeping the rest as is.
 */
export function capitalizeFirst(text: string): string {
  if (!text) return '';
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/**
 * Safely extracts a display label from a metadata field.
 * Handles both legacy string values and new LinkedEntity objects.
 * Supports dynamic language selection.
 */
export function getLabel(
  value: string | LinkedEntity | (string | LinkedEntity)[] | undefined | null, 
  lang: string = 'et'
): string {
  if (!value) return '';
  
  let label = '';

  // Kui on massiiv, töötle esimest elementi
  if (Array.isArray(value)) {
    if (value.length === 0) return '';
    label = getLabel(value[0], lang);
  } else if (typeof value === 'string') {
    label = value;
  } else if (value.labels && value.labels[lang]) {
    // LinkedEntity objekt koos eelistatud keelega
    label = value.labels[lang] || '';
  } else {
    // LinkedEntity ilma eelistatud keeleta (fallback label)
    label = value.label || '';
  }

  return capitalizeFirst(label);
}

/**
 * Safely extracts a Wikidata ID from a metadata field.
 * Returns null if the value is a legacy string or a manual entry.
 */
export function getId(value: string | LinkedEntity | undefined | null): string | null {
  if (!value || typeof value === 'string') return null;
  return value.id || null;
}

/**
 * Safely extracts labels as an array for indexing/searching.
 */
export function getAllLabels(value: string | LinkedEntity | undefined | null): string[] {
  const label = getLabel(value);
  if (!label) return [];
  if (typeof value === 'string' || !value.labels) return [label];
  
  const labels = Object.values(value.labels).filter((l): l is string => !!l);
  if (!labels.includes(label)) {
    labels.unshift(label);
  }
  return Array.from(new Set(labels));
}
