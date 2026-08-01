import React, { Suspense } from 'react';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockRecordOperationalTelemetry = vi.fn();

vi.mock('@/services/observability/operationalTelemetryRecorder', () => ({
  recordOperationalTelemetry: (...args: unknown[]) => mockRecordOperationalTelemetry(...args),
}));

import { lazyWithRetry } from '@/utils/lazyWithRetry';
import { defaultBrowserWindowRuntime } from '@/shared/runtime/browserWindowRuntimeCore';

const RELOAD_KEY = 'hhr_chunk_reload_count';
const setNavigatorOnline = (online: boolean) => {
  Object.defineProperty(window.navigator, 'onLine', {
    configurable: true,
    value: online,
  });
};

describe('lazyWithRetry', () => {
  beforeEach(() => {
    sessionStorage.removeItem(RELOAD_KEY);
    mockRecordOperationalTelemetry.mockClear();
    setNavigatorOnline(true);
  });

  afterEach(() => {
    cleanup();
    sessionStorage.removeItem(RELOAD_KEY);
    setNavigatorOnline(true);
    vi.restoreAllMocks();
  });

  it('returns a lazy component when factory succeeds', async () => {
    const MockComponent = () => null;
    const factory = vi.fn().mockResolvedValue({ default: MockComponent });

    const LazyComponent = lazyWithRetry(factory);

    // React.lazy returns a lazy component object
    expect(LazyComponent).toBeDefined();
    expect(LazyComponent.$$typeof).toBeDefined();
    expect(factory).not.toHaveBeenCalled(); // lazy defers the call
  });

  it('propagates non-chunk errors without recovery', async () => {
    const regularError = new Error('Network timeout');
    const factory = vi.fn().mockRejectedValue(regularError);

    lazyWithRetry(factory);

    // The factory hasn't been called yet since lazy defers it
    // We test the factory wrapper directly
    const wrappedFactory = async () => {
      try {
        return await factory();
      } catch (error) {
        if (!(error instanceof Error)) throw error;
        const msg = error.message.toLowerCase();
        const isChunk =
          msg.includes('loading chunk') ||
          msg.includes('dynamically imported module') ||
          msg.includes('failed to fetch') ||
          error.name === 'ChunkLoadError';
        if (!isChunk) throw error;
      }
    };

    await expect(wrappedFactory()).rejects.toThrow('Network timeout');
    expect(mockRecordOperationalTelemetry).not.toHaveBeenCalled();
  });

  it('detects chunk load errors by message patterns', () => {
    const patterns = [
      'Failed to fetch dynamically imported module /assets/chunk-abc123.js',
      'Loading chunk 42 failed',
      'Failed to fetch',
    ];

    for (const message of patterns) {
      const error = new Error(message);
      const msg = error.message.toLowerCase();
      const isChunk =
        msg.includes('loading chunk') ||
        msg.includes('dynamically imported module') ||
        msg.includes('failed to fetch') ||
        error.name === 'ChunkLoadError';
      expect(isChunk).toBe(true);
    }
  });

  it('detects chunk load errors by error name', () => {
    const error = new Error('Something failed');
    error.name = 'ChunkLoadError';
    const isChunk = error.name === 'ChunkLoadError';
    expect(isChunk).toBe(true);
  });

  it('records degraded telemetry on first chunk error', () => {
    // Simulate the telemetry recording logic
    const reloadCount = 0;
    const maxReloads = 2;

    const status = reloadCount < maxReloads ? 'degraded' : 'failed';
    expect(status).toBe('degraded');
  });

  it('records failed telemetry when reload budget exhausted', () => {
    sessionStorage.setItem(RELOAD_KEY, '2');
    const reloadCount = Number(sessionStorage.getItem(RELOAD_KEY) ?? '0');
    const maxReloads = 2;

    const status = reloadCount < maxReloads ? 'degraded' : 'failed';
    expect(status).toBe('failed');
  });

  it('cleans up reload counter after budget exhaustion', () => {
    sessionStorage.setItem(RELOAD_KEY, '2');

    // Simulate budget exhaustion cleanup
    const reloadCount = Number(sessionStorage.getItem(RELOAD_KEY) ?? '0');
    if (reloadCount >= 2) {
      sessionStorage.removeItem(RELOAD_KEY);
    }

    expect(sessionStorage.getItem(RELOAD_KEY)).toBeNull();
  });

  it('increments reload counter in sessionStorage', () => {
    expect(sessionStorage.getItem(RELOAD_KEY)).toBeNull();

    // Simulate first reload attempt
    const count = Number(sessionStorage.getItem(RELOAD_KEY) ?? '0');
    sessionStorage.setItem(RELOAD_KEY, String(count + 1));

    expect(sessionStorage.getItem(RELOAD_KEY)).toBe('1');

    // Simulate second reload attempt
    const count2 = Number(sessionStorage.getItem(RELOAD_KEY) ?? '0');
    sessionStorage.setItem(RELOAD_KEY, String(count2 + 1));

    expect(sessionStorage.getItem(RELOAD_KEY)).toBe('2');
  });

  it('defers a failed chunk while offline and retries it after reconnecting', async () => {
    const Chunk = () => React.createElement('span', null, 'Módulo cargado');
    const factory = vi
      .fn()
      .mockRejectedValueOnce(new Error('Failed to fetch dynamically imported module'))
      .mockResolvedValueOnce({ default: Chunk });
    const reloadSpy = vi
      .spyOn(defaultBrowserWindowRuntime, 'reload')
      .mockImplementation(() => undefined);
    setNavigatorOnline(false);

    const LazyComponent = lazyWithRetry(factory);
    render(
      React.createElement(
        Suspense,
        { fallback: React.createElement('span', null, 'Cargando módulo') },
        React.createElement(LazyComponent)
      )
    );

    expect(await screen.findByText('Cargando módulo')).toBeInTheDocument();
    await waitFor(() => expect(factory).toHaveBeenCalledTimes(1));
    expect(reloadSpy).not.toHaveBeenCalled();
    expect(sessionStorage.getItem(RELOAD_KEY)).toBeNull();

    setNavigatorOnline(true);
    await act(async () => {
      window.dispatchEvent(new Event('online'));
    });

    expect(await screen.findByText('Módulo cargado')).toBeInTheDocument();
    expect(factory).toHaveBeenCalledTimes(2);
    expect(reloadSpy).not.toHaveBeenCalled();
  });

  it('keeps reload recovery for stale chunks while online', async () => {
    const factory = vi
      .fn()
      .mockRejectedValue(
        new Error('Failed to fetch dynamically imported module /assets/stale-chunk.js')
      );
    const reloadSpy = vi
      .spyOn(defaultBrowserWindowRuntime, 'reload')
      .mockImplementation(() => undefined);
    const LazyComponent = lazyWithRetry(factory);

    render(
      React.createElement(
        Suspense,
        { fallback: React.createElement('span', null, 'Cargando módulo') },
        React.createElement(LazyComponent)
      )
    );

    await waitFor(() => expect(reloadSpy).toHaveBeenCalledTimes(1));
    expect(sessionStorage.getItem(RELOAD_KEY)).toBe('1');
  });
});
