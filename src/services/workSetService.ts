/**
 * Töökollektsioonide API-klient (#354).
 *
 * ID-loendit hoitakse AINULT aktiivse valiku jaoks ja see EI OLE TTL-vahemälu:
 * vastus sõltub kutsujast ja teoste lugemisõigusest, mis muutuvad kogu
 * `revision`-ist sõltumatult. Loend visatakse ära valiku vahetusel, liikmesuse
 * muutmisel ja autentimisoleku muutumisel.
 *
 * Aegunud loend EI ava ühtki dokumenti, mida tenant-token ei lubaks — ta laseb
 * ainult jätkata samade ID-de filtreerimist kuni järgmise päringuni.
 */
import { apiGet, apiPost, apiPatch, apiPut, apiDelete, apiDeleteWithBody } from './apiClient';

export interface WorkSetSummary {
  id: string;
  name: Record<string, string>;
  description?: Record<string, string>;
  visibility: 'members' | 'public';
  status: 'active' | 'archived';
  revision: number;
  can_manage: boolean;
  /** Ainult halduritele/adminile. */
  access?: Record<string, 'viewer' | 'manager'>;
  created_by?: string;
  updated_at?: string;
  ever_published?: boolean;
}

interface WorkIdsResponse {
  work_ids: string[];
  count: number;
  revision: number;
}

const AUTH = { useLocalStorageToken: true } as const;

const idCache = new Map<string, { workIds: string[]; revision: number }>();
// Samaaegsed kutsed (nt Dashboard + päise loendur) ei tohi teha kahte päringut.
// Lennusolev lubadus EI ole vahemälu: ta kustutatakse ka vea korral.
const lennus = new Map<string, Promise<string[]>>();

export function invalidateWorkSetIds(setId?: string): void {
  if (setId) {
    idCache.delete(setId);
    lennus.delete(setId);
  } else {
    idCache.clear();
    lennus.clear();
  }
}

export async function getWorkSetWorkIds(setId: string): Promise<string[]> {
  const hit = idCache.get(setId);
  if (hit) return hit.workIds;
  const pooleli = lennus.get(setId);
  if (pooleli) return pooleli;

  const promise = (async () => {
    // 403/404 EI tohi muutuda tühjaks loendiks: kutsuja peab eristama
    // „ligipääs kadus" ja „kogu on tühi". Viga ei vahemälustata.
    const data = await apiGet<WorkIdsResponse>(`/work-sets/${setId}/works`, AUTH);
    idCache.set(setId, { workIds: data.work_ids, revision: data.revision });
    return data.work_ids;
  })().finally(() => {
    lennus.delete(setId);
  });

  lennus.set(setId, promise);
  return promise;
}

/** Kutsujale nähtavate liikmete arv ilma ID-loendit eraldi hoidmata. */
export async function getWorkSetCount(setId: string): Promise<number> {
  return (await getWorkSetWorkIds(setId)).length;
}

export async function listWorkSets(includeArchived = false): Promise<WorkSetSummary[]> {
  const data = await apiGet<{ work_sets: WorkSetSummary[] }>(
    `/work-sets?include_archived=${includeArchived}`, AUTH);
  return data.work_sets;
}

/**
 * Kogud, kuhu see teos kuulub ja mida kutsuja näeb (#354).
 *
 * EI ole vahemälustatud: kuuluvus muutub iga lisamise/eemaldamisega ja vaade
 * peab muutust kohe näitama. Vastus on kutsujapõhine.
 */
export async function getWorkSetsForWork(workId: string): Promise<WorkSetSummary[]> {
  const data = await apiGet<{ work_sets: WorkSetSummary[] }>(
    `/work-sets/for-work/${encodeURIComponent(workId)}`, AUTH);
  return data.work_sets;
}

export async function getWorkSet(setId: string): Promise<WorkSetSummary> {
  const data = await apiGet<{ work_set: WorkSetSummary }>(`/work-sets/${setId}`, AUTH);
  return data.work_set;
}

export async function createWorkSet(
  name: Record<string, string>,
  description: Record<string, string> = { et: '', en: '' },
): Promise<WorkSetSummary> {
  const data = await apiPost<{ work_set: WorkSetSummary }>('/work-sets', { name, description }, AUTH);
  return data.work_set;
}

export async function patchWorkSet(
  setId: string, changes: Record<string, unknown>, revision: number,
): Promise<WorkSetSummary> {
  const data = await apiPatch<{ work_set: WorkSetSummary }>(
    `/work-sets/${setId}`, { ...changes, revision }, AUTH);
  invalidateWorkSetIds(setId);
  return data.work_set;
}

export async function setWorkSetAccess(
  setId: string, access: Record<string, 'viewer' | 'manager'>, revision: number,
): Promise<WorkSetSummary> {
  const data = await apiPut<{ work_set: WorkSetSummary }>(
    `/work-sets/${setId}/access`, { access, revision }, AUTH);
  // Ligipääsu muutus muudab seda, mida SEE kutsuja loendis näeb.
  invalidateWorkSetIds(setId);
  return data.work_set;
}

export async function deleteWorkSet(setId: string): Promise<void> {
  await apiDelete(`/work-sets/${setId}`, AUTH);
  invalidateWorkSetIds(setId);
}

/**
 * `revision` on VALIKULINE: liikmete muutmine on delta („lisa need" /
 * „eemalda need"), mitte täisasendus, seega vananenud revisjon ei saa kellegi
 * muudatust maha kirjutada. UI jätab ta saatmata — nõudmine annaks ainult
 * valepositiivseid 409-sid, kui kaks haldurit töötavad korraga.
 */
export async function addWorks(
  setId: string, workIds: string[], revision?: number,
): Promise<WorkIdsResponse> {
  const data = await apiPost<WorkIdsResponse>(
    `/work-sets/${setId}/works`, { work_ids: workIds, revision }, AUTH);
  invalidateWorkSetIds(setId);
  return data;
}

export async function removeWorks(
  setId: string, workIds: string[], revision?: number,
): Promise<WorkIdsResponse> {
  const data = await apiDeleteWithBody<WorkIdsResponse>(
    `/work-sets/${setId}/works`, { work_ids: workIds, revision }, AUTH);
  invalidateWorkSetIds(setId);
  return data;
}

export interface WorkSetMember {
  work_id: string;
  title: string;
  year_display?: string | null;
}

/**
 * Liikmete pealkirjad kuvamiseks. Meilist, sest sealsamas on juba
 * tenant-tokeni ligipääsufilter — kutsuja ei näe siit midagi, mida ta
 * otsingus ei näeks. ID-d tulevad serverilt (`getWorkSetWorkIds`), mis on
 * omakorda juba kutsujale filtreeritud; Meili on siin ainult SILDIALLIKAS.
 */
export async function getWorkSetMembers(
  index: { search: (q: string, opts: Record<string, unknown>) => Promise<{ hits: unknown[] }> },
  workIds: string[],
): Promise<WorkSetMember[]> {
  if (workIds.length === 0) return [];
  const res = await index.search('', {
    filter: [
      'lehekylje_number = 1',
      `work_id IN [${workIds.map(id => `"${id}"`).join(', ')}]`,
    ],
    attributesToRetrieve: ['work_id', 'pealkiri', 'title', 'year_display', 'aasta'],
    limit: workIds.length,
  });
  const kaart = new Map<string, WorkSetMember>();
  for (const hit of res.hits as Record<string, unknown>[]) {
    const id = hit.work_id as string;
    if (!id || kaart.has(id)) continue;
    kaart.set(id, {
      work_id: id,
      title: (hit.pealkiri ?? hit.title ?? id) as string,
      year_display: (hit.year_display ?? hit.aasta ?? null) as string | null,
    });
  }
  // Järjekord tuleb kogu loendist, mitte Meili vastusest. Puuduv teos jääb
  // nimekirja id-ga: „ei leitud" on info, vaikne kadumine ei ole.
  return workIds.map(id => kaart.get(id) ?? { work_id: id, title: id, year_display: null });
}
