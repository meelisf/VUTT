import { Page, Annotation } from '../types';
import { FILE_API_URL } from '../config';
import { fetchWithTimeout, getAuthHeaders } from '../utils/fetchWithTimeout';

export interface CommentVersion {
  commit_hash: string;
  timestamp: string;
  author: string;
  text: string;
}

export interface DeletedComment {
  id: string;
  text: string;
  author: string;
  created_at: string;
  replies: Annotation['replies'];
  last_seen_commit: string;
}

export interface CommentHistory {
  versions: Record<string, CommentVersion[]>;
  deleted: DeletedComment[];
  truncated: boolean;
}

function pageFileNames(page: Page): { original_path: string; file_name: string } {
  const imageFilename = page.image_url.split('/').pop() || '';
  const file_name = imageFilename.replace(/\.[^/.]+$/, '') + '.txt';
  return {
    original_path: page.original_path || page.originaal_kataloog || '',
    file_name,
  };
}

export async function fetchCommentHistory(
  page: Page,
  authToken?: string,
): Promise<CommentHistory> {
  const response = await fetchWithTimeout(`${FILE_API_URL}/page-comments/history`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...getAuthHeaders(authToken) },
    body: JSON.stringify(pageFileNames(page)),
    timeout: 30000,
  });
  if (!response.ok) {
    const e = await response.json().catch(() => ({}));
    throw new Error(e.detail || `History failed: ${response.status}`);
  }
  const data = await response.json();
  return {
    versions: data.versions || {},
    deleted: data.deleted || [],
    truncated: !!data.truncated,
  };
}

export async function restoreComment(
  page: Page,
  params: { mode: 'version' | 'deleted'; comment_id: string; commit_hash: string },
  authToken?: string,
): Promise<Annotation[]> {
  const response = await fetchWithTimeout(`${FILE_API_URL}/page-comments/restore`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...getAuthHeaders(authToken) },
    body: JSON.stringify({ ...pageFileNames(page), ...params }),
    timeout: 30000,
  });
  if (!response.ok) {
    const e = await response.json().catch(() => ({}));
    throw new Error(e.detail || `Restore failed: ${response.status}`);
  }
  const data = await response.json();
  return data.comments || [];
}
