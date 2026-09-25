/** @vitest-environment jsdom */
import { describe, expect, it } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useLatestQuery } from '../useLatestQuery';

/** Käsitsi lahendatav päring: test otsustab, millal ja mis järjekorras vastused saabuvad. */
function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

function setup(initial: { key: string | null; scope: string }) {
  const calls: { key: string | null; d: ReturnType<typeof deferred<string>> }[] = [];
  const hook = renderHook(
    ({ key, scope }) => useLatestQuery(key, scope, () => {
      const d = deferred<string>();
      calls.push({ key, d });
      return d.promise;
    }),
    { initialProps: initial },
  );
  return { hook, calls };
}

describe('useLatestQuery', () => {
  it('esmalaadimine: andmeid ei ole, laadimine käib', () => {
    const { hook } = setup({ key: 'a', scope: 's' });
    expect(hook.result.current.data).toBeUndefined();
    expect(hook.result.current.initialLoading).toBe(true);
    expect(hook.result.current.refreshing).toBe(false);
  });

  it('vastupidises järjekorras saabunud vana vastus ei kirjuta uut üle (#421)', async () => {
    const { hook, calls } = setup({ key: 'a', scope: 's' });
    hook.rerender({ key: 'b', scope: 's' });
    expect(calls.map(c => c.key)).toEqual(['a', 'b']);

    await act(async () => { calls[1].d.resolve('B'); });
    expect(hook.result.current.data).toBe('B');
    expect(hook.result.current.refreshing).toBe(false);

    await act(async () => { calls[0].d.resolve('A'); });
    expect(hook.result.current.data).toBe('B');
    expect(hook.result.current.refreshing).toBe(false);
  });

  it('vana päringu viga ei muuda aktiivse päringu viga ega laadimisolekut', async () => {
    const { hook, calls } = setup({ key: 'a', scope: 's' });
    hook.rerender({ key: 'b', scope: 's' });
    await act(async () => { calls[0].d.reject(new Error('vana')); });
    expect(hook.result.current.error).toBeNull();
    expect(hook.result.current.initialLoading).toBe(true);

    await act(async () => { calls[1].d.resolve('B'); });
    expect(hook.result.current.error).toBeNull();
    expect(hook.result.current.data).toBe('B');
  });

  it('kordusotsingul jääb senine tulemus nähtavaks ja laadimine on „uuendamine"', async () => {
    const { hook, calls } = setup({ key: 'a', scope: 's' });
    await act(async () => { calls[0].d.resolve('A'); });
    hook.rerender({ key: 'b', scope: 's' });
    expect(hook.result.current.data).toBe('A');
    expect(hook.result.current.refreshing).toBe(true);
    expect(hook.result.current.initialLoading).toBe(false);
  });

  it('ulatuse vahetusel vana ulatuse tulemust ei näidata', async () => {
    const { hook, calls } = setup({ key: 'a', scope: 's1' });
    await act(async () => { calls[0].d.resolve('A'); });
    hook.rerender({ key: 'a', scope: 's2' });
    expect(calls).toHaveLength(2);
    expect(hook.result.current.data).toBeUndefined();
    expect(hook.result.current.initialLoading).toBe(true);
  });

  it('keelatud päring (key = null) ei lase lennusoleval vastusel olekut muuta', async () => {
    const { hook, calls } = setup({ key: 'a', scope: 's' });
    hook.rerender({ key: null, scope: 's' });
    expect(hook.result.current.initialLoading).toBe(false);
    await act(async () => { calls[0].d.resolve('A'); });
    expect(hook.result.current.data).toBeUndefined();
  });

  it('viga on aktiivse päringu oma; reload kordab sama päringut', async () => {
    const { hook, calls } = setup({ key: 'a', scope: 's' });
    await act(async () => { calls[0].d.reject(new Error('katki')); });
    expect(hook.result.current.error).toBeInstanceOf(Error);
    expect(hook.result.current.initialLoading).toBe(false);

    act(() => { hook.result.current.reload(); });
    expect(calls).toHaveLength(2);
    expect(hook.result.current.error).toBeNull();
    await act(async () => { calls[1].d.resolve('A'); });
    expect(hook.result.current.data).toBe('A');
  });

  it('sama võtmega uuesti renderdamine ei tee uut päringut', () => {
    const { hook, calls } = setup({ key: 'a', scope: 's' });
    hook.rerender({ key: 'a', scope: 's' });
    expect(calls).toHaveLength(1);
  });
});
