/**
 * Transkriptsiooni aluse vahetus teise eksemplari vastu (ADR 0089 p 6).
 * Server: `server/promote.py` + asenduse konksud; lõpetamine teose märgi järgi.
 */
import { apiGet, apiPost } from './apiClient';

export interface PromotePage {
  stem: string;
  page: number;
  status: string;
  /** Eksemplari id, kelle lehestikku leht praegu kuulub; null = teadmata. */
  origin: string | null;
  edited: boolean;
  fingerprint: string;
}

export interface PromotePreview {
  pages: PromotePage[];
  /** Toimetatud lehed: tüvi → sõrmejälg (kinnitus kehtib just sellele seisule). */
  edited: Record<string, string>;
  unknown: string[];
  unstorable: { stem: string; reason: string }[];
  images: number;
  witness: string | null;
  parts: number;
}

export interface PromoteConfirmBody {
  unknown_target: string | null;
  confirmed_edited: Record<string, string>;
}

/** Lõpetamise tulemus: `restored` = vana lehestik taastati (vahetust EI toimunud). */
export type ReplaceFinishResult = 'replaced' | 'restored' | 'cleared';

const opts = (token: string | null) => ({ token, timeout: 60_000 });

export function fetchPromotePreview(workId: string, eid: string, token: string | null): Promise<PromotePreview> {
  return apiGet<PromotePreview>(
    `/admin/work/${encodeURIComponent(workId)}/exemplars/${encodeURIComponent(eid)}/promote/preview`, opts(token));
}

export async function startPromote(workId: string, eid: string, body: PromoteConfirmBody,
  token: string | null): Promise<string> {
  const r = await apiPost<{ upload_id: string }>(
    `/admin/work/${encodeURIComponent(workId)}/exemplars/${encodeURIComponent(eid)}/promote`, body, opts(token));
  return r.upload_id;
}

export async function confirmPromote(uploadId: string, body: PromoteConfirmBody, token: string | null): Promise<void> {
  await apiPost(`/admin/upload/${encodeURIComponent(uploadId)}/promote/confirm`, body, opts(token));
}

export async function finishReplace(workId: string, uploadId: string, token: string | null): Promise<ReplaceFinishResult> {
  const r = await apiPost<{ result: ReplaceFinishResult }>(
    `/admin/work/${encodeURIComponent(workId)}/replace/finish`, { upload_id: uploadId }, opts(token));
  return r.result;
}

/** Asenduse/alguse 409, millele saab vastata uue kinnitusega (detail.detail = värske eelvaade). */
export const PROMOTE_RECONFIRM_CODES = ['edited_pages_changed', 'origins_changed', 'target_missing'] as const;
