/**
 * Lehekülje operatsioonid: lugemine, salvestamine, ootel muudatused
 */

import { Annotation, Page } from '../types';
import { FILE_API_URL } from '../config';
import { ApiError, apiPost } from './apiClient';
import { checkMixedContent, normalizePage } from './meiliService';
import type { Index } from 'meilisearch';
import type { Quad4 } from '../utils/perspectiveQuad';
import { PageConflictError, conflictFromResponse, type PageFields } from '../components/editor/pageConflict';
import { pageFileFromImageUrl } from './workImageService';
import { quoteFilterValue } from '../utils/filterUtils';

/** `/save` viide agendi tekstiettepanekule (#641). */
export interface ProposalRef { id: string; stem: string }

// Abifunktsioon failisüsteemi salvestamiseks
const saveToFileSystem = async (
  page: Page, original_catalog: string, image_url: string, authToken?: string, base?: PageFields,
  proposal?: ProposalRef,
): Promise<{ merged?: boolean; page?: PageFields }> => {
  try {
    const imageFilename = pageFileFromImageUrl(image_url);
    const textFilename = imageFilename.replace(/\.[^/.]+$/, "") + ".txt";

    if (!textFilename) {
      console.error("Ei suutnud tuletada failinime pildi URL-ist:", image_url);
      return {};
    }

    const metaContent = {
      status: page.status,
      page_tags: page.page_tags, // Use explicit naming for page-level tags
      comments: page.comments,
      text_annotations: page.text_annotations,
      history: page.history,
      work_id: page.work_id,
      updated_at: new Date().toISOString()
    };

    const payload: any = {
      text_content: page.text_content,
      meta_content: metaContent,
      original_path: original_catalog,
      file_name: textFilename,
      work_id: page.work_id,
      // Kolmesuunalise liitmise baas (#455, ADR 0054)
      ...(base ? { base } : {}),
      // Agendi tekstiettepaneku kinnitus (#641) — ainult superadmin
      ...(proposal ? { proposal } : {}),
    };

    let result: any;
    try {
      result = (await apiPost(`${FILE_API_URL}/save`, payload, { token: authToken, timeout: 30000 })) ?? {};
    } catch (e) {
      if (!(e instanceof ApiError)) throw e;
      const conflict = conflictFromResponse(e.status, e.data);
      if (conflict) throw conflict;
      if (e.status === 401 || e.message.includes('Autentimine')) {
        const err = new Error('AUTH_EXPIRED');
        (err as any).status = 401;
        throw err;
      }
      throw new Error(`File server error: ${e.status}`);
    }

    // Kontrolli git commit hoiatust vastuses
    if (result.warning) {
      console.warn("Git commit hoiatus:", result.warning);
    }

    // Konsistentsikontroll: logi hoiatus kui ann-ID-d tekstis ja text_annotations massiiv ei klapi
    if (page.text_annotations && page.text_annotations.length > 0) {
      const { findAnnIdsInText } = await import('../utils/annUtils');
      const textIds = new Set(findAnnIdsInText(page.text_content || ''));
      const metaIds = new Set(page.text_annotations.map(a => a.id));
      const onlyInText = [...textIds].filter(id => !metaIds.has(id));
      const onlyInMeta = [...metaIds].filter(id => !textIds.has(id));
      if (onlyInText.length > 0 || onlyInMeta.length > 0) {
        console.warn('[annUtils] Konsistentsiprobleem:', { onlyInText, onlyInMeta });
      }
    }

    return result;
  } catch (e: any) {
    // Lase 401 vead ja kokkupõrge läbi — Workspace/redaktor käsitleb neid
    if (e.message === 'AUTH_EXPIRED' || e.status === 401 || e instanceof PageConflictError) {
      throw e;
    }
    console.error("Failed to save to file system:", e);
    throw new Error(`Salvestamine ebaõnnestus: ${e.message || 'Failisüsteemi kirjutamine ebaõnnestus.'}`);
  }
};

// Töölaud: Saa ühe lehekülje andmed
export const getPage = async (index: Index, workId: string, pageNum: number): Promise<Page | null> => {
  checkMixedContent();
  try {
    // Otsime work_id (nanoid) järgi
    // See võimaldab mõlemat tüüpi URL-e: /work/r20x08/1 ja /work/1640-4/1
    const response = await index.search('', {
      filter: [`work_id = ${quoteFilterValue(workId)}`, `lehekylje_number = ${pageNum}`],
      limit: 1
    });

    if (response.hits.length === 0) return null;
    const hit: any = response.hits[0];
    return normalizePage(hit);
  } catch (error) {
    console.error("Get Page Error:", error);
    throw error;
  }
};

// Töölaud: Salvesta muudatused
// NB: history massiivi enam ei kasutata - versiooniajalugu tuleb Gitist
export const savePage = async (
  page: Page,
  _actionDescription: string = 'Muutis andmeid',
  _userName: string = 'Anonüümne',
  authToken?: string,
  base?: PageFields,
  proposal?: ProposalRef,
): Promise<{ page: Page; merged: PageFields | null }> => {
  try {
    // Meilisearchi uuendamine toimub backendis (file_server.py kutsub sync_work_to_meilisearch)
    // Frontend kasutab ainult otsinguvõtit, millel pole kirjutamisõigust

    if (page.original_path && page.image_url) {
      const result = await saveToFileSystem(page, page.original_path, page.image_url, authToken, base, proposal);
      // Server liitis vahepealse ketta seisu (#455) — see on nüüd salvestatud leht.
      if (result.merged && result.page) {
        return { page: { ...page, ...result.page }, merged: result.page };
      }
    } else {
      console.warn("Ei saa faili salvestada: puudub original_path või image_url");
    }

    return { page, merged: null };
  } catch (error) {
    console.error("Save Page Error:", error);
    throw error;
  }
};

export const replyToComment = async (
  page: Page,
  commentId: string,
  text: string,
  authToken?: string
): Promise<Annotation[]> => {
  const imageFilename = pageFileFromImageUrl(page.image_url);
  const textFilename = imageFilename.replace(/\.[^/.]+$/, "") + ".txt";

  const data = await apiPost<{ comments?: Annotation[]; git_committed?: boolean; warning?: string }>(
    `${FILE_API_URL}/page-comments/reply`, {
      original_path: page.original_path || page.originaal_kataloog,
      file_name: textFilename,
      work_id: page.work_id,
      page_number: page.page_number,
      comment_id: commentId,
      text,
    }, { token: authToken, timeout: 30000 });
  // Sama käsitlus nagu lehe salvestusel: vastus on kettal, ajalugu võib puududa.
  if (data.git_committed === false) console.warn("Git commit hoiatus:", data.warning);
  return data.comments || [];
};

export interface CropRect { x: number; y: number; w: number; h: number; }
export interface TransformResult {
  success: boolean; changed: boolean; filename?: string;
  size?: [number, number]; thumbnail_warning?: boolean; reason?: string;
}

// Admin: pöörab/kärbib/sirgestab lehepilti kohapeal (failinime-põhine endpoint)
export async function transformPageImage(
  workId: string, filename: string, angle: number, crop: CropRect | null, token: string,
  quad?: Quad4,
): Promise<TransformResult> {
  const body = quad ? { angle, quad } : { angle, crop };
  return apiPost(
    `${FILE_API_URL}/admin/work/${workId}/page-image/${encodeURIComponent(filename)}/transform`,
    body, { token, timeout: 30000 },
  );
}

export interface RestoreResult {
  success: boolean;
  restored: boolean;
  reason?: string;
  thumbnail_warning?: boolean;
}

// Admin: taastab lehe pildi ._originals pristine versiooni (ainult pilt)
export async function restoreOriginalPageImage(
  workId: string, filename: string, token: string,
): Promise<RestoreResult> {
  return apiPost(
    `${FILE_API_URL}/admin/work/${workId}/page-image/${encodeURIComponent(filename)}/restore-original`,
    undefined, { token, timeout: 30000 },
  );
}
