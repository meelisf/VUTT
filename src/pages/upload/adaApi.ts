import { apiPost } from '../../services/apiClient';
import type { AdaLookupResult, AdaMergeTulemus, AdaVormiVali } from './types';

/** `createUpload`-i lisaväljad ADA-voos — tühi objekt tavapärase (mitte-ADA)
 *  loomise puhul, et payload jääks täpselt selliseks nagu enne ADA-tuge. */
export interface AdaCreateExtras {
  ada?: {
    handle: string;
    item_uuid: string;
    sources: Array<{ name: string; bitstream_uuid: string; size_bytes: number }>;
  };
  languages?: string[];
  creators?: Array<{ label: string }>;
  year_display?: string;
  ester_id?: string | null;
  archive_refs?: Array<{ archive_id: string; reference: string }>;
  external_url?: string | null;
}

/** Handle → ADA metaandmed + failiplaan. Ei loo uploadi.
 *  Endpoint nõuab admin-rolli (`require_role("admin")`) — token PEAB kaasa minema,
 *  muidu vastab server 401-ga ja vorm ei täitu kunagi (vt uploadApi.ts mustrit). */
export async function adaLookup(handle: string, token: string | null): Promise<AdaLookupResult> {
  const vastus = await apiPost<{ status: string; ada: AdaLookupResult }>(
    '/admin/ada/lookup',
    { handle },
    { token },
  );
  return vastus.ada;
}

/** Käivitab ADA failide allalaadimise. 409 = juba käib. */
export async function adaFetch(uploadId: string, token: string | null): Promise<void> {
  await apiPost(`/admin/upload/${uploadId}/ada-fetch`, {}, { token });
}

/**
 * `createUpload`-i payload'i ADA-plokk. `null` (tavapärane, mitte-ADA loomine)
 * → tühi objekt, spreaditav ilma ühegi `ada`/`languages`/... võtmeta —
 * see on ainus koht, mis vastutab selle eest, et tavaline üleslaadimine EI
 * kanna kunagi ADA-välju kaasa (Task 11 review'st: puudus test, mis seda
 * kinnitaks, vt `adaCreatePayload.test.ts`).
 */
export function buildAdaCreateExtras(adaResult: AdaLookupResult | null): AdaCreateExtras {
  if (!adaResult) return {};
  return {
    ada: {
      handle: adaResult.handle,
      item_uuid: adaResult.item_uuid,
      sources: adaResult.failid.map((f) => ({
        name: f.name,
        bitstream_uuid: f.bitstream_uuid,
        size_bytes: f.size_bytes,
      })),
    },
    languages: adaResult.meta.languages,
    creators: adaResult.meta.creators,
    year_display: adaResult.meta.year_display,
    ester_id: adaResult.meta.ester_id,
    archive_refs: adaResult.meta.archive_refs,
    external_url: adaResult.meta.external_url,
  };
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
