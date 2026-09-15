/**
 * Kasutajate diakriitikatundetu otsing õiguste paneelides (#318).
 *
 * Eraldi utiliit, sest sama otsingut vajavad nii töökollektsiooni kui
 * kollektsiooni ligipääsupaneel. Kaks koopiat lahknesid juba korra:
 * kollektsioonipaneel ei leidnud „jogi"-ga nime „Jõgi", töökollektsiooni oma
 * leidis. Eestikeelsete nimede juures on see päris viga, mitte kosmeetika.
 */
import { normalizeForSearch } from './diacritics';

export interface SearchableUser {
  username: string;
  name: string;
  email: string;
}

/** Otsib nime, kasutajanime ja e-posti järgi. Tühi päring annab kõik. */
export function searchUsers<T extends SearchableUser>(users: T[], query: string): T[] {
  const q = normalizeForSearch(query);
  if (!q) return users;
  return users.filter(u =>
    normalizeForSearch(u.name).includes(q)
    || normalizeForSearch(u.username).includes(q)
    || normalizeForSearch(u.email).includes(q));
}
