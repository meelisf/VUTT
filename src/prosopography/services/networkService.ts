// src/prosopography/services/networkService.ts
/**
 * Isiku seoste võrgustik (#461): GET /prosopography/{id}/network.
 * Andmeleping: docs/superpowers/specs/2026-09-26-isiku-seoste-vaade-design.md.
 */
import { FILE_API_URL } from '../../config';
import { fetchWithTimeout } from '../../utils/fetchWithTimeout';

export type RelationKind = 'academic' | 'dedicated' | 'family' | 'cotext' | 'mention' | 'printer';

export interface NetworkPerson {
  id: string;
  label: string;
  birth_year: number | null;
  death_year: number | null;
  origin: { place: string | null; place_id: string | null; coordinates: { lat: number; lon: number } | null } | null;
}

export interface NetworkWork {
  work_id: string;
  title: string;
  year: number | null;
  place: { id: string | null; label: string; coordinates: { lat: number; lon: number } | null } | null;
  genres: string[];
  restricted: boolean;
}

export interface FamilyRecord { source_id: string; target_id: string; type: string | null; }

export interface NetworkEdge {
  kind: RelationKind;
  from: string;
  to: string;
  directed: boolean;
  roles?: Record<string, string[]>;
  records?: FamilyRecord[];
  year: number | null;
  place: { id: string | null; kind: 'print' | 'event' | 'sent_from' } | null;
  evidence: { work_id: string; pages: number[]; part_id?: string } | null;
}

export interface PersonNetwork {
  focus: NetworkPerson;
  persons: NetworkPerson[];
  works: NetworkWork[];
  edges: NetworkEdge[];
}

export async function fetchPersonNetwork(personId: string, collection?: string | null): Promise<PersonNetwork> {
  const url = new URL(`${FILE_API_URL}/prosopography/${personId}/network`, window.location.origin);
  if (collection) url.searchParams.set('collection', collection);
  const resp = await fetchWithTimeout(url.toString(), { timeout: 15000 });
  if (!resp.ok) throw new Error(`fetchPersonNetwork: ${resp.status}`);
  return resp.json();
}
