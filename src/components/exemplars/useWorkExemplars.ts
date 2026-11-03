import { useEffect, useRef, useState } from 'react';
import type { Work } from '../../types';
import { useUser } from '../../contexts/UserContext';
import { getWorkExemplars, type WorkExemplarsResponse } from '../../services/workApi';

/**
 * Teose eksemplarid infopaneelile: üks päring nii kaartidele kui plokile
 * „Samas köites" (#702). Päring ainult siis, kui teosel on eksemplare
 * (`archive_refs` on neist tuletatud) või konvoluut — muidu ei maksa iga lehe
 * avamine lisapäringut.
 */
export function useWorkExemplars(work: Work | undefined): WorkExemplarsResponse | null {
  const { authToken } = useUser();
  const [data, setData] = useState<WorkExemplarsResponse | null>(null);
  // Hiljaks jäänud vastus visatakse ära (teose vahetus või järjestikused salvestused, ADR 0010 vaim).
  const reqSeq = useRef(0);
  const workId = work?.work_id;
  // Arvud, mitte massiiv: Workspace laadib teose objekti uuesti iga tokeni vahetuse
  // peale ja uus massiiv tähendaks asjatut päringut (ADR 0060 vaim).
  const refCount = work?.archive_refs?.length || 0;
  const convoluteCount = work?.convolute_count || 0;
  const rev = work?.exemplars_rev;

  // Teose vahetus: eelmise teose andmed kohe maha. Sama teose uuesti laadimisel
  // (eksemplari salvestus) jäävad vanad päringu ajaks nähtavale — muidu vilguks.
  useEffect(() => {
    reqSeq.current += 1;
    setData(null);
  }, [workId]);

  useEffect(() => {
    const seq = ++reqSeq.current;
    if (!workId || (refCount === 0 && convoluteCount === 0)) { setData(null); return; }
    getWorkExemplars(workId, authToken)
      .then(res => { if (reqSeq.current === seq) setData(res); })
      .catch(() => {});
    // `exemplars_rev` (kliendi loendur) annab uue laadimise eksemplaride salvestusel ka siis,
    // kui arvud ei muutu.
  }, [workId, refCount, convoluteCount, authToken, rev]);

  return data;
}
