/** @vitest-environment jsdom */
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const navigate = vi.fn();
vi.mock('react-router-dom', () => ({ useNavigate: () => navigate }));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));

// PersonAddPanel'i enda käitumist testib PersonAddPanel.test.tsx — siin huvitab
// ainult NewPersonStart'i marsruutimisotsus onDone tulemuse põhjal.
let capturedOnDone: ((r: { id: string; label: string; created: boolean }) => void) | null = null;
vi.mock('../../components/PersonAddPanel', () => ({
  default: (props: any) => {
    capturedOnDone = props.onDone;
    return <div data-testid="panel-stub" data-inline={String(props.inline)} />;
  },
}));

import NewPersonStart from '../NewPersonStart';

describe('NewPersonStart', () => {
  beforeEach(() => { navigate.mockReset(); capturedOnDone = null; });

  it('renderdab paneeli inline kujul', () => {
    render(<NewPersonStart initialQuery="Hezel" token="t" lang="et" onManual={vi.fn()} />);
    expect(screen.getByTestId('panel-stub').dataset.inline).toBe('true');
  });

  it('onDone created=false suunab isiku profiilile', () => {
    render(<NewPersonStart initialQuery="Hezel" token="t" lang="et" onManual={vi.fn()} />);
    capturedOnDone!({ id: 'vutt:Pabc', label: 'Hezel', created: false });
    expect(navigate).toHaveBeenCalledWith('/persons/vutt%3APabc');
  });

  it('onDone created=true suunab isiku muutmisvaatesse', () => {
    render(<NewPersonStart initialQuery="Hezel" token="t" lang="et" onManual={vi.fn()} />);
    capturedOnDone!({ id: 'vutt:Pnew', label: 'Hezel', created: true });
    expect(navigate).toHaveBeenCalledWith('/persons/vutt%3APnew/edit');
  });

  it('„Täida vorm käsitsi" kutsub onManual', () => {
    const onManual = vi.fn();
    render(<NewPersonStart initialQuery="Hezel" token="t" lang="et" onManual={onManual} />);
    fireEvent.click(screen.getByText('panel.manualForm'));
    expect(onManual).toHaveBeenCalled();
  });
});
