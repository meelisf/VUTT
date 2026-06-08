import { LinkedEntity } from '../types/LinkedEntity';
import { pickLabelByLang } from './labelUtils';

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
  } else if (value.labels && value.source !== 'local') {
    // Wikidata kirjetel kasuta mitmekeelseid tõlkeid; lokaalsetel (VUTT isikud) mitte
    label = pickLabelByLang(value.labels, lang) || value.label || '';
  } else {
    // LinkedEntity ilma eelistatud keeleta (fallback label)
    label = value.label || '';
  }

  return capitalizeFirst(label);
}

