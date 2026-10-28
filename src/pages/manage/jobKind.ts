import type { PageOpsStatus, WorkJobKind } from '../../services/workApi';

/**
 * Teose taustatöid on mitut liiki (ADR 0074), aga teose kohta käib korraga üks.
 * Klient jälgib ainult OMA liiki tööd: lehetoimingute lõpp tühjendab ootel
 * plaani ja kui PDF-töö satuks sinna, kaoks rakendamata pööre/kärbe.
 */

/** Vana server ei kanna liiki — siis oli ainus töö lehetoimingud. */
const kindOf = (st: Pick<PageOpsStatus, 'kind'>): WorkJobKind => st.kind ?? 'page_ops';

/** 409 järel: jälgi oma liigi tööd, teavita teise liigi tööst, lõppenud töö korral proovi uuesti. */
export function jobConflictAction(
  status: Pick<PageOpsStatus, 'state' | 'kind'>,
  mine: WorkJobKind,
): 'follow' | 'other' | 'retry' {
  if (status.state !== 'running') return 'retry';
  return kindOf(status) === mine ? 'follow' : 'other';
}

/** Lehe avamisel: millise liigi jälgija käivitada (null = tööd ei käi). */
export function resumeFollower(status: Pick<PageOpsStatus, 'state' | 'kind'>): WorkJobKind | null {
  return status.state === 'running' ? kindOf(status) : null;
}
