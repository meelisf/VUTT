/** @vitest-environment jsdom */
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, it, expect, vi } from 'vitest';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string, d?: any) => (typeof d === 'string' ? d : k), i18n: { language: 'et' } }),
}));
vi.mock('../../../services/prosopographyService', () => ({ listPersons: vi.fn(async () => ({ results: [] })), getPerson: vi.fn() }));
vi.mock('../../../../services/wikidataService', () => ({
  searchWikidata: vi.fn(async () => [{ id: 'Q28966944', label: 'Academia Gustaviana', description: 'wd', url: '' }]),
  getEntityLabels: vi.fn(async () => ({})),
}));
vi.mock('../../../../services/gndService', () => ({ searchGnd: vi.fn(async () => []) }));
vi.mock('../../../../services/viafService', () => ({ searchViaf: vi.fn(async () => []) }));
vi.mock('../../../../contexts/UserContext', () => ({ useUser: () => ({ user: { role: 'editor' } }) }));

vi.mock('../../RegistryEntryModal', () => ({
  default: (props: any) => <div>
    <span>modal:{props.kind}:{props.initialQuery}</span>
    <button onClick={() => props.onCreated('tartu-gumnaasium-1630', { id: 'Q20641850', labels: { et: 'Tartu gümnaasium' }, variants: [] })}>
      stub-create</button>
  </div>,
}));

import RegistryField from '../RegistryField';

const REG = { 'academia-gustavo-carolina': { id: 'Q138710754', labels: { et: 'Academia Gustavo-Carolina' }, variants: ['AGC'], place_key: 'Dorpat' } };

function setup(registryKey?: string, value: any = null, extra: Record<string, unknown> = {}) {
  const onPick = vi.fn(); const onUnlink = vi.fn(); const onChange = vi.fn();
  render(<MemoryRouter><RegistryField registry={REG} placeholder="p" lang="et" value={value} registryKey={registryKey}
    onChange={onChange} onPick={onPick} onUnlink={onUnlink} {...extra} /></MemoryRouter>);
  return { onPick, onUnlink, onChange };
}

describe('RegistryField', () => {
  it('registri vaste on esimene ja valik läheb onPick-i koos trükitud tekstiga', async () => {
    const { onPick, onChange } = setup();
    const box = screen.getByRole('textbox');
    fireEvent.focus(box);
    fireEvent.change(box, { target: { value: 'AGC' } });
    const row = await screen.findByText('Academia Gustavo-Carolina');
    await screen.findByText('Academia Gustaviana');                      // Wikidata tuleb järel
    const labels = screen.getAllByText(/Academia Gustav/).map(e => e.textContent);
    expect(labels[0]).toBe('Academia Gustavo-Carolina');
    fireEvent.mouseDown(row); fireEvent.click(row);
    expect(onPick).toHaveBeenCalledWith(expect.objectContaining({ key: 'academia-gustavo-carolina' }), 'AGC');
    expect(onChange).not.toHaveBeenCalled();
  });

  it('seotud kirje kiip ja lahtisidumine', () => {
    const { onUnlink } = setup('academia-gustavo-carolina');
    expect(screen.getByText(/Academia Gustavo-Carolina · Q138710754/)).toBeTruthy();
    fireEvent.click(screen.getByLabelText('form.registry.unlink'));
    expect(onUnlink).toHaveBeenCalled();
  });

  it('Q-kood ilma registrivõtmeta on nähtavalt sidumata; sama Q → „Seo"', () => {
    // Rostock: faktil Q159895, registris sama Q-ga kirje, aga võtit pole — vormis nägi välja seotud.
    const { onPick } = setup(undefined, { label: 'AGC Tartu', id: 'Q138710754', labels: null, source: 'wikidata' },
      { unlinkedNote: 'kaardile ei jõua', createKind: 'institution' });
    expect(screen.getByText('form.registry.unlinked — kaardile ei jõua')).toBeTruthy();
    fireEvent.click(screen.getByText('form.registry.linkTo'));
    expect(onPick).toHaveBeenCalledWith(expect.objectContaining({ key: 'academia-gustavo-carolina' }), 'AGC Tartu');
    expect(screen.queryByText('form.registry.create')).toBeNull();          // vaste olemas → loomist ei paku
  });

  it('vasteta sidumata väli: admin avab akna; loodud kirje seotakse väljaga', () => {
    const { onPick } = setup(undefined, { label: 'Tartu gümnaasium', id: 'Q20641850', labels: null, source: 'wikidata' },
      { createKind: 'institution', token: 't' });
    fireEvent.click(screen.getByText('form.registry.create'));
    expect(screen.getByText('modal:institution:Tartu gümnaasium')).toBeTruthy();   // otsing algab välja tekstist
    fireEvent.click(screen.getByText('stub-create'));
    expect(onPick).toHaveBeenCalledWith(expect.objectContaining({ key: 'tartu-gumnaasium-1630', label: 'Tartu gümnaasium' }),
      'Tartu gümnaasium');
    expect(screen.queryByText(/modal:/)).toBeNull();
  });

  it('seotud või tühi väli sidumata silti ei näita; ilma createKind-ita linki pole', () => {
    setup('academia-gustavo-carolina', { label: 'AGC', id: 'Q138710754', labels: null, source: 'wikidata' });
    expect(screen.queryByText(/form.registry.unlinked/)).toBeNull();
  });

  it('tühi väli ei ole „sidumata"', () => {
    setup();
    expect(screen.queryByText(/form.registry.unlinked/)).toBeNull();
  });

  it('mitte-admin näeb silti, aga mitte loomise nuppu', () => {
    setup(undefined, { label: 'Tartu gümnaasium', id: null, labels: null, source: 'manual' });
    expect(screen.getByText('form.registry.unlinked')).toBeTruthy();
    expect(screen.queryByText('form.registry.create')).toBeNull();
  });

  it('seotud väljal on kastis allika sõnastus, mitte registri silt', () => {
    // univ-rostock kandis silti „Rostock"; väli näitas pärast „Seo" linna, mitte „Rostocki Ülikool".
    setup('academia-gustavo-carolina', { label: 'Acad. Dorpat.', id: 'Q138710754',
      labels: { et: 'Academia Gustavo-Carolina', en: 'Academia Gustavo-Carolina' }, source: 'wikidata' });
    expect((screen.getByRole('textbox') as HTMLInputElement).value).toBe('Acad. Dorpat.');
    expect(screen.getByText(/Academia Gustavo-Carolina · Q138710754/)).toBeTruthy();
  });
});
