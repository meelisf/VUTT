import { describe, expect, it } from 'vitest';
import { parseRestoreResponse, savedStateAfterRestore } from '../pageRestore';
import type { EditorSavedState } from '../useEditorSave';
import { PageStatus } from '../../../types';

const prev: EditorSavedState = {
  status: PageStatus.IN_PROGRESS,
  comments: [{ id: 'c1', text: 'vana', author: 'u', created_at: '' }],
  page_tags: ['Q1'],
  text_annotations: [{ id: 1, comment: 'x' } as never],
};

describe('parseRestoreResponse', () => {
  it('loeb teksti, kirjed ja lepituse kommentaarid', () => {
    const r = parseRestoreResponse({
      status: 'success', restored_content: 'tekst', git_committed: true,
      restored_text_annotations: [], restored_comments: [{ id: 'k', text: 'Endine…' }],
    });
    expect(r).toEqual({
      content: 'tekst', textAnnotations: [], comments: [{ id: 'k', text: 'Endine…' }], gitWarning: null,
    });
  });

  it('JSON-ita lehel on kirjed ja kommentaarid null, mitte tühjad', () => {
    const r = parseRestoreResponse({
      status: 'success', restored_content: 't', restored_text_annotations: null, restored_comments: null,
    });
    expect(r?.textAnnotations).toBeNull();
    expect(r?.comments).toBeNull();
  });

  it('ebaõnnestunud git-commit annab hoiatuse, mitte vaikse edu', () => {
    const r = parseRestoreResponse({
      status: 'success', restored_content: 't', git_committed: false, git_error: 'index.lock',
    });
    expect(r?.gitWarning).toBe('index.lock');
  });

  it('veavastus ei ole taaste', () => {
    expect(parseRestoreResponse({ status: 'error', message: 'x' })).toBeNull();
    expect(parseRestoreResponse(null)).toBeNull();
  });
});

describe('savedStateAfterRestore', () => {
  it('võtab serveri kirjed ja kommentaarid, staatus ja märksõnad jäävad', () => {
    const uus = savedStateAfterRestore(prev, {
      content: 't', textAnnotations: [], comments: [], gitWarning: null,
    });
    expect(uus).toEqual({ ...prev, text_annotations: [], comments: [] });
  });

  it('null väli ei tühjenda senist', () => {
    expect(savedStateAfterRestore(prev, {
      content: 't', textAnnotations: null, comments: null, gitWarning: null,
    })).toEqual(prev);
  });
});
