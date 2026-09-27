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

const panel = vi.hoisted(() => ({ props: null as any }));
vi.mock('../../../prosopography/components/PersonAddPanel', () => ({
  default: (props: any) => {
    panel.props = props;
    return <button type="button" onClick={() => props.onDone({ id: 'vutt:Pnew', label: 'Johann Fischer', created: true })}>paneel-valmis</button>;
  },
}));
const role = vi.hoisted(() => ({ value: 'editor' as string | null }));
vi.mock('../../../contexts/UserContext', () => ({ useUser: () => ({ user: role.value ? { role: role.value } : null }) }));

import CreatorsEditor from '../CreatorsEditor';

const ROLES = [{ id: 'auctor', label: 'Autor' }, { id: 'addressee', label: 'Adressaat' }];

beforeEach(() => { seen.length = 0; panel.props = null; role.value = 'editor'; });

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

  it('sidumata nimi: „Seo / loo isik" avab paneeli nimega ja seob valitud isiku', () => {
    const onChange = vi.fn();
    render(<CreatorsEditor creators={[{ name: 'Fischer', role: 'addressee' }, { name: 'Luden', id: 'vutt:Pold', role: 'auctor' }]}
      onChange={onChange} roles={ROLES} newRole="auctor" lang="et" token="tok" workId="w1" />);
    const buttons = screen.getAllByRole('button', { name: 'Seo / loo isik' });
    expect(buttons).toHaveLength(1);                           // juba seotud real nuppu ei ole
    fireEvent.click(buttons[0]);
    expect(panel.props).toMatchObject({ initialQuery: 'Fischer', token: 'tok', context: { work_id: 'w1', role: 'addressee' } });
    fireEvent.click(screen.getByText('paneel-valmis'));
    expect(onChange).toHaveBeenCalledWith([
      expect.objectContaining({ id: 'vutt:Pnew', name: 'Johann Fischer', role: 'addressee' }),
      expect.objectContaining({ id: 'vutt:Pold' }),
    ]);
  });

  it('ilma tokeni või toimetaja rollita nuppu ei ole', () => {
    role.value = 'contributor';
    render(<CreatorsEditor creators={[{ name: 'Fischer', role: 'addressee' }]} onChange={() => {}} roles={ROLES}
      newRole="auctor" lang="et" token="tok" />);
    expect(screen.queryByRole('button', { name: 'Seo / loo isik' })).toBeNull();
  });
});
