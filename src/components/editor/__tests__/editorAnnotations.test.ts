import { describe, it, expect } from 'vitest';
import { EditorState, Transaction } from '@codemirror/state';
import { isPageSwapUpdate, pageSwapAnnotation } from '../editorAnnotations';

/**
 * Regressioonitest #185-st tulnud vea vastu: lehe vahetusel asendatakse kogu
 * dokument ühe dispatch'iga, mis on `docChanged`. Ilma märgistuseta luges
 * updateListener selle kasutaja muudatuseks ja lahkumisel küsiti salvestamist,
 * kuigi kasutaja polnud midagi teinud.
 */
describe('isPageSwapUpdate', () => {
  const state = EditorState.create({ doc: 'vana leht' });

  const pageSwap = () =>
    state.update({
      changes: { from: 0, to: state.doc.length, insert: 'uus leht' },
      annotations: pageSwapAnnotation.of(true),
    });

  it('tunneb lehe vahetuse tehingu ära', () => {
    expect(isPageSwapUpdate([pageSwap()])).toBe(true);
  });

  it('kasutaja tippimist ei loeta lehe vahetuseks', () => {
    const typing = state.update({
      changes: { from: 0, insert: 'x' },
      annotations: Transaction.userEvent.of('input.type'),
    });
    expect(isPageSwapUpdate([typing])).toBe(false);
  });

  it('märgistuseta programmaatiline muudatus ei ole lehe vahetus', () => {
    const plain = state.update({ changes: { from: 0, insert: 'x' } });
    expect(isPageSwapUpdate([plain])).toBe(false);
  });

  it('tühi tehingute nimekiri ei ole lehe vahetus', () => {
    expect(isPageSwapUpdate([])).toBe(false);
  });

  it('lehe vahetuse tehing EI kanna userEvent märgistust', () => {
    // Kriitiline: marginaliaProtectionFilter ja vuttAutoSanitizer tegutsevad
    // ainult userEvent-tehingutel. Kui lehe vahetus saaks userEvent'i, hakkaks
    // sanitiseerija kettalt laetud teksti muutma.
    expect(pageSwap().annotation(Transaction.userEvent)).toBeUndefined();
  });
});
