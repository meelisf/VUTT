/**
 * Workspace'i lehe laadimise võti. Lehe laadimise effect jookseb ka siis, kui
 * muutub ainult otsingu-`index` (Meili tokeni uuendus iga ~10 min, S27-03),
 * sessiooni olek või sisselogimine. Juba laetud lehe uuesti laadimine asendab
 * redaktori sisu serveri versiooniga ja salvestamata töö kaob (kkrxpe,
 * 2026-09-28). Uuesti laaditakse ainult siis, kui võti muutub: teine teos,
 * teine leht või teine lugemisõigus (viewer-token).
 */
export function pageLoadKey(workId: string, pageNum: number, viewerToken: string | null): string {
  return `${workId}/${pageNum}/${viewerToken ?? ''}`;
}

export function needsPageLoad(loadedKey: string | null, key: string): boolean {
  return loadedKey !== key;
}
