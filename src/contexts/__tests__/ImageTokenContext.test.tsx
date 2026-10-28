/** @vitest-environment jsdom */
import React from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../services/apiClient';

const user = vi.hoisted(() => ({ authToken: 'a' as string | null }));
const getViewerToken = vi.hoisted(() => vi.fn());

vi.mock('../UserContext', () => ({ useUser: () => ({ authToken: user.authToken }) }));
vi.mock('../../services/workApi', () => ({ getViewerToken }));

import { ImageTokenProvider, useImageToken, useImageTokenFetcher, withImageToken } from '../ImageTokenContext';

const wrapper = ({ children }: { children: React.ReactNode }) => <ImageTokenProvider>{children}</ImageTokenProvider>;
const inAnHour = () => Math.floor(Date.now() / 1000) + 3600;

describe('ImageTokenContext (#673)', () => {
  beforeEach(() => {
    user.authToken = 'a';
    getViewerToken.mockReset();
  });

  it('üks päring teose kohta, ka mitme tarbija peale', async () => {
    getViewerToken.mockResolvedValue({ image_exp: inAnHour(), image_sig: 's' });
    const { result } = renderHook(() => [useImageToken('w1'), useImageToken('w1')], { wrapper });
    await waitFor(() => expect(result.current[0]?.sig).toBe('s'));
    expect(result.current[1]?.sig).toBe('s');
    expect(getViewerToken).toHaveBeenCalledTimes(1);
    expect(getViewerToken).toHaveBeenCalledWith('w1', 'a');
  });

  it('uus sessioon = uus vahemälu (allkiri sõltub kasutajast)', async () => {
    getViewerToken.mockResolvedValue({ image_exp: inAnHour(), image_sig: 's' });
    const { result, rerender } = renderHook(() => useImageTokenFetcher(), { wrapper });
    await result.current('w1');
    user.authToken = 'b';
    rerender();
    await result.current('w1');
    expect(getViewerToken).toHaveBeenCalledTimes(2);
    expect(getViewerToken).toHaveBeenLastCalledWith('w1', 'b');
  });

  it('serveri „ei" jääb meelde, võrgutõrge mitte', async () => {
    const { result } = renderHook(() => useImageTokenFetcher(), { wrapper });
    getViewerToken.mockRejectedValueOnce(new ApiError('ei', 403));
    expect(await result.current('w1')).toBeNull();
    expect(await result.current('w1')).toBeNull();
    expect(getViewerToken).toHaveBeenCalledTimes(1);

    getViewerToken.mockRejectedValueOnce(new TypeError('network'));
    getViewerToken.mockResolvedValueOnce({ image_exp: inAnHour(), image_sig: 'ok' });
    expect(await result.current('w2')).toBeNull();
    expect((await result.current('w2'))?.sig).toBe('ok');
  });

  it('aeguv allkiri küsitakse uuesti', async () => {
    const { result } = renderHook(() => useImageTokenFetcher(), { wrapper });
    getViewerToken.mockResolvedValueOnce({ image_exp: Math.floor(Date.now() / 1000) + 60, image_sig: 'vana' });
    getViewerToken.mockResolvedValueOnce({ image_exp: inAnHour(), image_sig: 'uus' });
    expect((await result.current('w1'))?.sig).toBe('vana');
    expect((await result.current('w1'))?.sig).toBe('uus');
  });

  it('enabled=false ei küsi; teise teose allkirja ei näidata', async () => {
    getViewerToken.mockResolvedValue({ image_exp: inAnHour(), image_sig: 's' });
    const { result, rerender } = renderHook(({ id, on }) => useImageToken(id, { enabled: on }), {
      wrapper, initialProps: { id: 'w1', on: false },
    });
    expect(getViewerToken).not.toHaveBeenCalled();
    rerender({ id: 'w1', on: true });
    await waitFor(() => expect(result.current?.sig).toBe('s'));
    getViewerToken.mockReturnValue(new Promise(() => {}));
    rerender({ id: 'w2', on: true });
    expect(result.current).toBeNull();
  });

  it('withImageToken valib eraldaja', () => {
    expect(withImageToken('/a.jpg', { exp: 1, sig: 'x' })).toBe('/a.jpg?exp=1&sig=x');
    expect(withImageToken('/a.jpg?v=2', { exp: 1, sig: 'x' })).toBe('/a.jpg?v=2&exp=1&sig=x');
    expect(withImageToken('/a.jpg', null)).toBe('/a.jpg');
  });
});
