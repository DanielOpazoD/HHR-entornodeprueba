import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import {
  loadFunctionsModule,
  isFunctionsReloadRequired,
} from '@/services/firebase-runtime/functionsModuleLoader';
import { defaultBrowserWindowRuntime } from '@/shared/runtime/browserWindowRuntimeCore';

const { getFunctions } = vi.hoisted(() => ({ getFunctions: vi.fn() }));
vi.mock('@/services/firebase-runtime/functionsRuntime', () => ({
  defaultFunctionsRuntime: { ready: Promise.resolve(), getFunctions },
}));
import FunctionsRecoveryNotice from '@/components/ui/FunctionsRecoveryNotice';

const failImport = () => Promise.reject(new TypeError('Importing a module script failed.'));
beforeEach(() => {
  getFunctions.mockReset();
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true);
  getFunctions.mockImplementation(() => loadFunctionsModule(failImport));
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }));
});
afterEach(async () => {
  cleanup();
  vi.restoreAllMocks();
  await loadFunctionsModule(() => import('firebase/functions'));
  vi.unstubAllGlobals();
});
it('warms while online at mount and after the online event, without invoking a callable', async () => {
  getFunctions.mockImplementation(() => loadFunctionsModule());
  render(<FunctionsRecoveryNotice />);
  await waitFor(() => expect(getFunctions).toHaveBeenCalledTimes(1));
  fireEvent.online(window);
  await waitFor(() => expect(getFunctions).toHaveBeenCalledTimes(2));
  expect(screen.queryByRole('status')).toBeNull();
});
it('does not import offline, then warms when the browser reports online', async () => {
  const online = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
  getFunctions.mockImplementation(() => loadFunctionsModule());
  render(<FunctionsRecoveryNotice />);
  expect(getFunctions).not.toHaveBeenCalled();
  online.mockReturnValue(true);
  fireEvent.online(window);
  await waitFor(() => expect(getFunctions).toHaveBeenCalledTimes(1));
});
it('waits for a successful connectivity probe and preserves the confirmation before reloading', async () => {
  vi.mocked(fetch).mockResolvedValue({ ok: false } as Response);
  const confirm = vi.spyOn(defaultBrowserWindowRuntime, 'confirm').mockReturnValue(false);
  const reload = vi.spyOn(defaultBrowserWindowRuntime, 'reload').mockImplementation(() => {});
  render(<FunctionsRecoveryNotice />);
  await waitFor(() => expect(fetch).toHaveBeenCalled());
  expect(screen.queryByRole('status')).toBeNull();
  vi.mocked(fetch).mockResolvedValue({ ok: true } as Response);
  fireEvent.online(window);
  expect(await screen.findByRole('status')).toHaveTextContent(
    'los cambios pendientes se conservan'
  );
  fireEvent.click(screen.getByRole('button', { name: 'Recargar aplicación' }));
  expect(confirm).toHaveBeenCalledWith(
    expect.stringContaining('Lo escrito en este formulario se perderá')
  );
  expect(reload).not.toHaveBeenCalled();
  confirm.mockReturnValue(true);
  fireEvent.click(screen.getByRole('button', { name: 'Recargar aplicación' }));
  expect(reload).toHaveBeenCalledTimes(1);
});
it('clears recovery when the browser can import the same module after connectivity returns', async () => {
  vi.mocked(fetch).mockResolvedValue({ ok: false } as Response);
  render(<FunctionsRecoveryNotice />);
  await waitFor(() => expect(isFunctionsReloadRequired()).toBe(true));
  getFunctions.mockImplementation(() => loadFunctionsModule());
  vi.mocked(fetch).mockResolvedValue({ ok: true } as Response);
  fireEvent.online(window);
  await waitFor(() => expect(isFunctionsReloadRequired()).toBe(false));
  expect(screen.queryByRole('status')).toBeNull();
});
