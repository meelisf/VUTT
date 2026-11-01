/** @vitest-environment jsdom */
// Tähelepanujuht „Teose info" päises: pill ainult olemasoleva sisu kohta (+ „Lisa märge").
import { describe, expect, it, vi, afterEach } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k, i18n: { language: 'et' } }),
}));

import AnnotationsGuide from '../AnnotationsGuide';

afterEach(() => cleanup());

const labels = () => screen.queryAllByRole('button').map(b => b.getAttribute('data-guide'));

describe('AnnotationsGuide', () => {
  it('näitab ainult olemasolevat, kindlas järjekorras, koos arvuga', () => {
    render(<AnnotationsGuide counts={{ pageNotes: 2, toc: 12, workTags: 0, pageTags: 1 }}
      canAddNote onJump={() => {}} />);
    expect(labels()).toEqual(['toc', 'pageTags', 'pageNotes']);
    expect(screen.getByText('12')).toBeTruthy();
    expect(screen.queryByText('info.guide.addNote')).toBeNull();   // märkmed on juba olemas
  });

  it('märkmeteta lehel on „Lisa märge", kui tohib lisada', () => {
    render(<AnnotationsGuide counts={{ workTags: 3 }} canAddNote onJump={() => {}} />);
    expect(labels()).toEqual(['workTags', 'addNote']);
  });

  it('lugemisrežiimis „Lisa märge" puudub; tühjana ei renderdu midagi', () => {
    const { container } = render(<AnnotationsGuide counts={{}} canAddNote={false} onJump={() => {}} />);
    expect(container.innerHTML).toBe('');
  });

  it('klõps annab võtme', () => {
    const onJump = vi.fn();
    render(<AnnotationsGuide counts={{ workSets: 1 }} canAddNote={false} onJump={onJump} />);
    fireEvent.click(screen.getByText('info.guide.workSets'));
    expect(onJump).toHaveBeenCalledWith('workSets');
  });
});
