import { afterEach, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { useDashboardData } from '../useDashboardData';
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
const response = (body: unknown, ok = true) => ({ ok, json: async () => body });
it('clears old project data when the next project fails to load', async () => {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => response({ project: 'first' }, !url.includes('second'))));
  const hook = renderHook(({ project }) => useDashboardData('30d', project), { initialProps: { project: 'first' } });
  await waitFor(() => expect(hook.result.current.traffic).toEqual({ project: 'first' }));
  hook.rerender({ project: 'second' });
  await waitFor(() => expect(hook.result.current.error).toBe('Failed to fetch traffic data'));
  expect(hook.result.current.traffic).toBeNull();
  expect(hook.result.current.apiUsage).toBeNull();
});
it('ignores a slow response after the selection changes', async () => {
  let finish: (value: ReturnType<typeof response>) => void = () => {};
  vi.stubGlobal('fetch', vi.fn((url: string) => url.includes('first')
    ? new Promise(resolve => { if (url.includes('ga-traffic')) finish = resolve; else resolve(response({ project: 'first' })); })
    : Promise.resolve(response({ project: 'second' }))));
  const hook = renderHook(({ project }) => useDashboardData('30d', project), { initialProps: { project: 'first' } });
  hook.rerender({ project: 'second' });
  await waitFor(() => expect(hook.result.current.traffic).toEqual({ project: 'second' }));
  await act(async () => finish(response({ project: 'first' })));
  expect(hook.result.current.traffic).toEqual({ project: 'second' });
  expect(hook.result.current.error).toBeNull();
});
