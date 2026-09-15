/**
 * Töökollektsiooni loomise tulemuse klassifikaator (#318 järelparandus).
 *
 * Tootmises teatas UI „Salvestamine ebaõnnestus", kuigi kogu loodi ära:
 * esimene git-commit pärast serveri taaskäivitust võttis 14,7 s ja klient
 * katkestas 10 s pealt. Üks `catch` ei tohi kahte eri olekut ühte teatesse
 * suruda.
 */
import { isAbortError } from '../../utils/isAbortError';

/** `kinnitamata` = vastust ei saadud; töö VÕIB olla tehtud. */
export type LoomiseTulem = 'kinnitamata' | 'viga';

export function loomiseTulem(error: unknown): LoomiseTulem {
  return isAbortError(error) ? 'kinnitamata' : 'viga';
}
