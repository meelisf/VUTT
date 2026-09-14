/**
 * Kasutajate viimane muudatus (#318, spekk §1).
 *
 * „Viimane muudatus" on git-commit, mitte viimane sisselogimine. Viga tõuseb
 * kutsujani: tühi kaart tähendaks „keegi ei ole midagi teinud" ja oleks
 * ebaõnnestunud laadimisest eristamatu.
 */
import { apiGet } from './apiClient';

export type UserActivity = Record<string, string>;

export async function getUserActivity(): Promise<UserActivity> {
  const d = await apiGet<{ status?: string; activity?: UserActivity }>(
    '/admin/users/activity', { useLocalStorageToken: true });
  return d.activity || {};
}
