import { Page, Annotation } from '../types';
import { FILE_API_URL } from '../config';
import { apiPost } from './apiClient';
import { pageFileFromImageUrl } from './workImageService';

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
  const imageFilename = pageFileFromImageUrl(page.image_url);
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
  const data = await apiPost<any>(`${FILE_API_URL}/page-comments/history`, pageFileNames(page),
    { token: authToken, timeout: 30000 });
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
): Promise<{ comments: Annotation[]; gitCommitted: boolean }> {
  const data = await apiPost<any>(`${FILE_API_URL}/page-comments/restore`, { ...pageFileNames(page), ...params },
    { token: authToken, timeout: 30000 });
  // Kommentaar on kettal ka siis, kui commit ebaõnnestus (#412 p1).
  return { comments: data.comments || [], gitCommitted: data.git_committed !== false };
}
