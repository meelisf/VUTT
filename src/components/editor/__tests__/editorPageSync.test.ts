import { describe, it, expect } from 'vitest';
import { isPageSwap, selectionAfterSync } from '../editorPageSync';

describe('isPageSwap', () => {
  it('esmane laadimine on lehevahetus', () => {
    expect(isPageSwap(null, 'cymbv7-1')).toBe(true);
  });

  it('teine lehenumber samas teoses on lehevahetus', () => {
    expect(isPageSwap('cymbv7-1', 'cymbv7-2')).toBe(true);
  });

  it('teine teos on lehevahetus', () => {
    expect(isPageSwap('cymbv7-1', 'abc123-1')).toBe(true);
  });

  it('sama leht uue objektiga EI ole lehevahetus', () => {
    // Salvestamine asendab `page` objekti (Workspace `setPage(savedPage)`),
    // aga kasutaja on endiselt samal leheküljel — kerimist ega kursorit ei tohi
    // liigutada.
    expect(isPageSwap('cymbv7-1', 'cymbv7-1')).toBe(false);
  });
});

describe('selectionAfterSync', () => {
  it('lehevahetusel algab uus leht algusest', () => {
    expect(selectionAfterSync({ isSwap: true, currentAnchor: 420, newDocLength: 900 })).toBe(0);
  });

  it('sama lehe värskendusel jääb kursor paigale', () => {
    expect(selectionAfterSync({ isSwap: false, currentAnchor: 420, newDocLength: 900 })).toBe(420);
  });

  it('kursor lõigatakse uue dokumendi pikkusele, kui normaliseerimine lühendas teksti', () => {
    // Serveri `normalize_marginalia_tags` eemaldab salvestamisel tühjad tagid,
    // seega salvestatud tekst võib olla lühem kui see, mis editoris oli.
    expect(selectionAfterSync({ isSwap: false, currentAnchor: 950, newDocLength: 900 })).toBe(900);
  });

  it('negatiivne või vigane ankur ei lähe alla nulli', () => {
    expect(selectionAfterSync({ isSwap: false, currentAnchor: -5, newDocLength: 900 })).toBe(0);
    expect(selectionAfterSync({ isSwap: false, currentAnchor: NaN, newDocLength: 900 })).toBe(0);
  });
});
