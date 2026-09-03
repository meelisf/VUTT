import { apiPost } from '../../services/apiClient';
import type { AdaLookupResult, AdaMergeTulemus, AdaVormiVali } from './types';

/** Handle → ADA metaandmed + failiplaan. Ei loo uploadi. */
export async function adaLookup(handle: string): Promise<AdaLookupResult> {
  const vastus = await apiPost<{ status: string; ada: AdaLookupResult }>(
    '/admin/ada/lookup',
    { handle },
  );
  return vastus.ada;
}

/** Käivitab ADA failide allalaadimise. 409 = juba käib. */
export async function adaFetch(uploadId: string): Promise<void> {
  await apiPost(`/admin/upload/${uploadId}/ada-fetch`, {});
}

/** Väljad, mida ADA täidab. Puhas nimekiri — UI ja test kasutavad sama. */
const ADA_VALJAD: AdaVormiVali[] = ['title', 'year', 'year_display'];

/**
 * Liidab ADA väärtused vormi nii, et admini käsitsi sisestatu EI kao.
 *
 * Tühjad väljad täidetakse; mittetühjad jäävad puutumata ja loetletakse
 * `ulekirjutatavad`-is, et UI saaks pakkuda ühekordset „võta ADA oma" nuppu.
 */
export function mergeAdaIntoForm(
  praegune: Partial<Record<AdaVormiVali, string>>,
  ada: Partial<Record<AdaVormiVali, string>>,
): AdaMergeTulemus {
  const vaartused: Record<string, string> = { ...praegune };
  const ulekirjutatavad: Array<{ vali: AdaVormiVali; adaVaartus: string }> = [];

  for (const vali of ADA_VALJAD) {
    const adaVaartus = (ada[vali] ?? '').trim();
    if (!adaVaartus) continue;
    const olemasolev = (praegune[vali] ?? '').trim();
    if (!olemasolev) {
      vaartused[vali] = adaVaartus;
    } else if (olemasolev !== adaVaartus) {
      ulekirjutatavad.push({ vali, adaVaartus });
    }
  }
  return { vaartused, ulekirjutatavad };
}
