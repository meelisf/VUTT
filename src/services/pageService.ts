/**
 * Lehekülje operatsioonid: lugemine, salvestamine, ootel muudatused
 */

import { Page, PageStatus } from '../types';
import { FILE_API_URL } from '../config';
import { fetchWithTimeout } from '../utils/fetchWithTimeout';
import { index, checkMixedContent } from './meiliService';
import { getFullImageUrl } from './workImageService';

// Autentimisandmete tüüp API päringute jaoks (tõendipõhine)
interface AuthToken {
  token: string;
}

// Abifunktsioon failisüsteemi salvestamiseks
const saveToFileSystem = async (page: Page, original_catalog: string, image_url: string, auth?: AuthToken): Promise<boolean> => {
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

    // Lisa autentimistõend kui olemas
    if (auth) {
      payload.auth_token = auth.token;
    }

    const response = await fetchWithTimeout(`${FILE_API_URL}/save`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
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
    return true;
  } catch (e: any) {
    // Lase 401 vead läbi — Workspace käsitleb neid
    if (e.message === 'AUTH_EXPIRED' || e.status === 401) {
      throw e;
    }
    console.error("Failed to save to file system:", e);
    alert(`Hoiatus: ${e.message || 'Failisüsteemi kirjutamine ebaõnnestus.'}`);
    return false;
  }
};

// =========================================================
// PENDING-EDITS FUNKTSIOONID (kaastööliste muudatused)
// =========================================================

export interface PendingEditInfo {
  has_own_pending: boolean;
  own_pending_edit: {
    id: string;
    submitted_at: string;
    new_text: string;
  } | null;
  other_pending_count: number;
}

// Kontrollib, kas lehel on ootel muudatusi
export const checkPendingEdits = async (
  teoseId: string,
  lehekyljeNumber: number,
  authToken: string
): Promise<PendingEditInfo> => {
  try {
    const response = await fetchWithTimeout(`${FILE_API_URL}/pending-edits/check`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        auth_token: authToken,
        work_id: teoseId,
        lehekylje_number: lehekyljeNumber
      })
    });

    const data = await response.json();

    if (data.status === 'success') {
      return {
        has_own_pending: data.has_own_pending,
        own_pending_edit: data.own_pending_edit,
        other_pending_count: data.other_pending_count
      };
    }

    return { has_own_pending: false, own_pending_edit: null, other_pending_count: 0 };
  } catch (e) {
    console.error('Check pending edits error:', e);
    return { has_own_pending: false, own_pending_edit: null, other_pending_count: 0 };
  }
};

// Salvestab muudatuse pending-olekusse (kaastöölise jaoks)
export const savePageAsPending = async (
  teoseId: string,
  lehekyljeNumber: number,
  originalText: string,
  newText: string,
  authToken: string
): Promise<{ success: boolean; editId?: string; hasOtherPending?: boolean; error?: string }> => {
  try {
    const response = await fetchWithTimeout(`${FILE_API_URL}/save-pending`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        auth_token: authToken,
        work_id: teoseId,
        lehekylje_number: lehekyljeNumber,
        original_text: originalText,
        new_text: newText
      }),
      timeout: 30000
    });

    const data = await response.json();

    if (data.status === 'success') {
      return {
        success: true,
        editId: data.edit_id,
        hasOtherPending: data.has_other_pending
      };
    }

    return { success: false, error: data.message };
  } catch (e: any) {
    console.error('Save pending edit error:', e);
    return { success: false, error: e.message || 'Salvestamine ebaõnnestus' };
  }
};

// Töölaud: Saa ühe lehekülje andmed
export const getPage = async (workId: string, pageNum: number): Promise<Page | null> => {
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

    return {
      // Identifikaatorid
      id: hit.id,
      work_id: hit.work_id,

      // Lehekülje andmed
      page_number: parseInt(hit.lehekylje_number),
      text_content: hit.text_content || hit.lehekylje_tekst || '',
      image_url: getFullImageUrl(hit.lehekylje_pilt),
      status: hit.status || PageStatus.RAW,
      comments: hit.comments || [],
      // Eelistame page_tags_object (objektid), fallback page_tags (stringid)
      page_tags: hit.page_tags_object || Array.from(new Set((hit.page_tags || []).map((t: any) =>
        typeof t === 'string' ? t.toLowerCase() : t
      ))),
      history: hit.history || [],

      // Teose andmed
      title: hit.title,
      year: hit.year ?? hit.aasta,
      location: hit.location,
      location_object: hit.location,
      publisher: hit.publisher,
      publisher_object: hit.publisher,
      type: hit.type,
      type_object: hit.type_object,
      genre: hit.genre_object || hit.genre,
      genre_object: hit.genre_object,
      collection: hit.collection,
      collections_hierarchy: hit.collections_hierarchy || [],
      creators: hit.creators || [],
      authors_text: hit.authors_text || [],
      tags: hit.tags || [],
      tags_object: hit.tags_object || [],
      languages: hit.languages || ['lat'],

      // Tagasiühilduvus (filtrite väljad)
      original_path: hit.originaal_kataloog,
      originaal_kataloog: hit.originaal_kataloog,
      autor: hit.autor,
      respondens: hit.respondens,
      aasta: hit.aasta ?? hit.year,
    };
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
  auth?: AuthToken
): Promise<Page> => {
  try {
    // Meilisearchi uuendamine toimub backendis (file_server.py kutsub sync_work_to_meilisearch)
    // Frontend kasutab ainult otsinguvõtit, millel pole kirjutamisõigust

    if (page.original_path && page.image_url) {
      await saveToFileSystem(page, page.original_path, page.image_url, auth);
    } else {
      console.warn("Ei saa faili salvestada: puudub original_path või image_url");
    }

    return page;
  } catch (error) {
    console.error("Save Page Error:", error);
    throw error;
  }
};
