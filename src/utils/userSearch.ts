/**
 * Kasutajate diakriitikatundetu otsing õiguste paneelides (#318).
 *
 * Eraldi utiliit, sest sama otsingut vajavad nii töökollektsiooni kui
 * kollektsiooni ligipääsupaneel. Kaks koopiat lahknesid juba korra:
 * kollektsioonipaneel ei leidnud „jogi"-ga nime „Jõgi", töökollektsiooni oma
 * leidis. Eestikeelsete nimede juures on see päris viga, mitte kosmeetika.
 */
export interface SearchableUser {
  username: string;
  name: string;
  email: string;
}

function normaliseeri(s: string): string {
  // NFD + kombineerivate märkide eemaldus: „Jõgi" ja „Jogi" peavad leidma
  // teineteist MÕLEMAS suunas.
  return (s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
}

/** Otsib nime, kasutajanime ja e-posti järgi. Tühi päring annab kõik. */
export function searchUsers<T extends SearchableUser>(users: T[], query: string): T[] {
  const q = normaliseeri(query);
  if (!q) return users;
  return users.filter(u =>
    normaliseeri(u.name).includes(q)
    || normaliseeri(u.username).includes(q)
    || normaliseeri(u.email).includes(q));
}
