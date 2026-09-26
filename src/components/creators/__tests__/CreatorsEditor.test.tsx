/** @vitest-environment jsdom */
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import '../../../pages/manage/parts/__tests__/testI18n';

const { seen } = vi.hoisted(() => ({ seen: [] as any[] }));
vi.mock('../../EntityPicker', () => ({
  default: (props: any) => {
    seen.push(props);
    return <button type="button" aria-label="pick" onClick={() => props.onChange({ id: 'Q9', label: 'Luden', source: 'wikidata' })}>pick</button>;
  },
}));

import CreatorsEditor from '../CreatorsEditor';

const ROLES = [{ id: 'auctor', label: 'Autor' }, { id: 'addressee', label: 'Adressaat' }];

beforeEach(() => { seen.length = 0; });

describe('CreatorsEditor', () => {
  it('annab EntityPickerile täisvarustuse (register, soovitused, keel, isikukontekst)', () => {
    const reg = [{ primary_name: 'X', aliases: [], ids: {} }];
    const sug = [{ label: 'Y', id: null }];
    render(<CreatorsEditor creators={[{ name: 'A', role: 'addressee' }]} onChange={() => {}} roles={ROLES}
      newRole="auctor" lang="et" token="tok" workId="w1" suggestions={sug} peopleRegister={reg} />);
    expect(seen[0]).toMatchObject({
      type: 'person', showPersonToggle: true, defaultPersonSearch: true, token: 'tok', lang: 'et',
      peopleRegister: reg, localSuggestions: sug, personContext: { work_id: 'w1', role: 'addressee' }, value: 'A',
    });
  });

  it('ilma teoseta isikukonteksti ei anta', () => {
    render(<CreatorsEditor creators={[{ name: 'A', role: 'auctor' }]} onChange={() => {}} roles={ROLES} newRole="auctor" lang="et" />);
    expect(seen[0].personContext).toBeUndefined();
  });

  it('lisa, vali, muuda rolli, eemalda', () => {
    const onChange = vi.fn();
    const { rerender } = render(<CreatorsEditor creators={[]} onChange={onChange} roles={ROLES} newRole="addressee" lang="et" />);
    expect(screen.getByText('Isikuid pole lisatud')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Lisa isik/ }));
    expect(onChange).toHaveBeenLastCalledWith([{ name: '', role: 'addressee' }]);

    rerender(<CreatorsEditor creators={[{ name: '', role: 'addressee' }]} onChange={onChange} roles={ROLES} newRole="addressee" lang="et" />);
    fireEvent.click(screen.getByRole('button', { name: 'pick' }));
    expect(onChange).toHaveBeenLastCalledWith([{ name: 'Luden', role: 'addressee', id: 'Q9', source: 'wikidata' }]);

    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'auctor' } });
    expect(onChange).toHaveBeenLastCalledWith([{ name: '', role: 'auctor' }]);

    fireEvent.click(screen.getByRole('button', { name: 'Eemalda' }));
    expect(onChange).toHaveBeenLastCalledWith([]);
  });

  it('vocabulary-väline roll jääb valikusse (ei kao vaikselt)', () => {
    render(<CreatorsEditor creators={[{ name: 'A', role: 'praeses' }]} onChange={() => {}} roles={ROLES} newRole="auctor" lang="et" />);
    expect((screen.getByRole('combobox') as HTMLSelectElement).value).toBe('praeses');
  });
});
