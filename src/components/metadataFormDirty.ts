/**
 * Metaandmete modaali salvestamata muudatuste tuvastus. Võrreldakse SALVESTATAVAT kuju
 * (`buildMetadataPayload`), mitte toorvormi: tühikud, tühjad read ja võtmete järjekord,
 * mis salvestusel kaovad, ei tohi dialoogi esile kutsuda.
 */
import { buildMetadataPayload, type MetadataFormData, type YearFieldsExisting } from '../utils/buildMetadataPayload';

/** Võtmete järjekorrast sõltumatu JSON (EntityPickeri objektid tulevad eri järjekorras). */
function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    return `{${Object.keys(obj).sort().filter(k => obj[k] !== undefined)
      .map(k => `${JSON.stringify(k)}:${stable(obj[k])}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

function snapshot(form: MetadataFormData, existing?: YearFieldsExisting): string {
  try {
    return stable(buildMetadataPayload(form, '', null, existing).metadata);
  } catch {
    // Vigane dateering: salvestatavat kuju ei ole — võrdle toorvormi (muudetud = muudatus).
    return `invalid:${stable(form)}`;
  }
}

export function isMetadataFormDirty(baseline: MetadataFormData, current: MetadataFormData,
  existing?: YearFieldsExisting): boolean {
  if (baseline === current) return false;
  return snapshot(baseline, existing) !== snapshot(current, existing);
}
