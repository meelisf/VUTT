/**
 * Lehekülje operatsioonid: lugemine, salvestamine, ootel muudatused
 */

import { Annotation, Page } from '../types';
import { FILE_API_URL } from '../config';
import { fetchWithTimeout, getAuthHeaders } from '../utils/fetchWithTimeout';
import { checkMixedContent, normalizePage } from './meiliService';
import type { Index } from 'meilisearch';

// Abifunktsioon failisüsteemi salvestamiseks
const saveToFileSystem = async (page: Page, original_catalog: string, image_url: string, authToken?: string): Promise<boolean> => {
  try {
    const imageFilename = image_url.split('/').pop() || '';
    const textFilename = imageFilename.replace(/\.[^/.]+$/, "") + ".txt";

    if (!textFilename) {
      console.error("Ei suutnud tuletada failinime pildi URL-ist:", image_url);
      return false;
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
      work_id: page.work_id
    };

    const response = await fetchWithTimeout(`${FILE_API_URL}/save`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...getAuthHeaders(authToken) },
      body: JSON.stringify(payload),
      timeout: 30000
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      if (errorData.message?.includes('Autentimine') || response.status === 401) {
        const err = new Error('AUTH_EXPIRED');
        (err as any).status = 401;
        throw err;
      }
      throw new Error(`File server error: ${response.status}`);
    }

    // Kontrolli git commit hoiatust vastuses
    const result = await response.json().catch(() => ({}));
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

    return true;
  } catch (e: any) {
    // Lase 401 vead läbi — Workspace käsitleb neid
    if (e.message === 'AUTH_EXPIRED' || e.status === 401) {
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
      filter: [`work_id = "${workId}"`, `lehekylje_number = ${pageNum}`],
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
  authToken?: string
): Promise<Page> => {
  try {
    // Meilisearchi uuendamine toimub backendis (file_server.py kutsub sync_work_to_meilisearch)
    // Frontend kasutab ainult otsinguvõtit, millel pole kirjutamisõigust

    if (page.original_path && page.image_url) {
      await saveToFileSystem(page, page.original_path, page.image_url, authToken);
    } else {
      console.warn("Ei saa faili salvestada: puudub original_path või image_url");
    }

    return page;
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
  const imageFilename = page.image_url.split('/').pop() || '';
  const textFilename = imageFilename.replace(/\.[^/.]+$/, "") + ".txt";

  const response = await fetchWithTimeout(`${FILE_API_URL}/page-comments/reply`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...getAuthHeaders(authToken) },
    body: JSON.stringify({
      original_path: page.original_path || page.originaal_kataloog,
      file_name: textFilename,
      work_id: page.work_id,
      page_number: page.page_number,
      comment_id: commentId,
      text,
    }),
    timeout: 30000
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.detail || errorData.message || `Reply failed: ${response.status}`);
  }

  const data = await response.json();
  return data.comments || [];
};
