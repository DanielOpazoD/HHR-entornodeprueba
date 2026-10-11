import React, { Suspense } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/services/observability/operationalTelemetryRecorder', () => ({
  recordOperationalTelemetry: vi.fn(),
}));

import { lazyWithRetry } from '@/utils/lazyWithRetry';
import { defaultBrowserWindowRuntime } from '@/shared/runtime/browserWindowRuntimeCore';

const setOnline = (value: boolean) =>
  Object.defineProperty(navigator, 'onLine', { configurable: true, value });
const chunkError = () => new Error('Failed to fetch dynamically imported module');
const Chunk = ({ label }: { label: string }) => React.createElement('span', null, label);

const mount = (factory: () => Promise<{ default: typeof Chunk }>) => {
  const Lazy = lazyWithRetry(factory);
  return render(
    React.createElement(
      React.Fragment,
      null,
      React.createElement('input', { 'aria-label': 'Borrador', defaultValue: 'Edición pendiente' }),
      React.createElement(
        Suspense,
        { fallback: 'Cargando módulo' },
        React.createElement(Lazy, { label: 'Módulo cargado' })
      )
    )
  );
};

class TestBoundary extends React.Component<{ children: React.ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed
      ? React.createElement('span', null, 'Error contenido')
      : this.props.children;
  }
}

describe('lazyWithRetry', () => {
  beforeEach(() => setOnline(true));
  afterEach(() => {
    cleanup();
    setOnline(true);
    vi.restoreAllMocks();
  });

  it('loads lazily and forwards the original component props', async () => {
    const factory = vi.fn().mockResolvedValue({ default: Chunk });
    const Lazy = lazyWithRetry(factory);
    expect(factory).not.toHaveBeenCalled();
    render(
      React.createElement(
        Suspense,
        { fallback: null },
        React.createElement(Lazy, { label: 'Prop conservada' })
      )
    );
    expect(await screen.findByText('Prop conservada')).toBeVisible();
  });

  it('waits offline and retries after reconnection without replacing the draft', async () => {
    setOnline(false);
    const factory = vi
      .fn()
      .mockRejectedValueOnce(chunkError())
      .mockResolvedValueOnce({ default: Chunk });
    const reload = vi.spyOn(defaultBrowserWindowRuntime, 'reload').mockImplementation(() => {});
    mount(factory);
    const input = screen.getByRole('textbox');
    await waitFor(() => expect(factory).toHaveBeenCalledTimes(1));
    expect(screen.getByText('Cargando módulo')).toBeVisible();
    setOnline(true);
    await act(async () => {
      window.dispatchEvent(new Event('online'));
    });
    expect(await screen.findByText('Módulo cargado')).toBeVisible();
    expect(screen.getByRole('textbox')).toBe(input);
    expect(input).toHaveValue('Edición pendiente');
    expect(reload).not.toHaveBeenCalled();
  });

  it.each([false, true])(
    'contains a persistent chunk error after offline=%s and only reloads with consent',
    async offline => {
      setOnline(!offline);
      const factory = vi.fn().mockRejectedValue(chunkError());
      const reload = vi.spyOn(defaultBrowserWindowRuntime, 'reload').mockImplementation(() => {});
      const confirm = vi.spyOn(defaultBrowserWindowRuntime, 'confirm').mockReturnValue(false);
      mount(factory);
      const input = screen.getByRole('textbox');
      await waitFor(() => expect(factory).toHaveBeenCalledTimes(1));
      if (offline) {
        setOnline(true);
        await act(async () => {
          window.dispatchEvent(new Event('online'));
        });
      }
      expect(await screen.findByRole('alert')).toHaveTextContent('Guarda tus cambios');
      expect(screen.getByRole('textbox')).toBe(input);
      expect(input).toHaveValue('Edición pendiente');
      expect(reload).not.toHaveBeenCalled();
      expect(confirm).not.toHaveBeenCalled();
      fireEvent.click(screen.getByRole('button', { name: 'Recargar aplicación' }));
      expect(reload).not.toHaveBeenCalled();
      confirm.mockReturnValue(true);
      fireEvent.click(screen.getByRole('button', { name: 'Recargar aplicación' }));
      expect(reload).toHaveBeenCalledTimes(1);
    }
  );

  it('propagates non-chunk failures to the existing error boundary', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const reload = vi.spyOn(defaultBrowserWindowRuntime, 'reload').mockImplementation(() => {});
    const Lazy = lazyWithRetry(vi.fn().mockRejectedValue(new Error('Invalid component contract')));
    render(
      React.createElement(
        TestBoundary,
        null,
        React.createElement(Suspense, { fallback: null }, React.createElement(Lazy))
      )
    );
    expect(await screen.findByText('Error contenido')).toBeVisible();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(reload).not.toHaveBeenCalled();
  });
});
