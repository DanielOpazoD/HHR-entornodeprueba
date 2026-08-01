/**
 * Lazy component loader with automatic recovery from chunk load errors.
 *
 * After a deploy on Netlify, old chunk filenames may no longer exist. Online
 * failures use a bounded reload budget to fetch the updated bundle. Offline
 * failures wait for connectivity and retry without reloading the workspace.
 */

import { lazy, type ComponentType } from 'react';
import { defaultBrowserWindowRuntime } from '@/shared/runtime/browserWindowRuntimeCore';
import { recordOperationalTelemetry } from '@/services/observability/operationalTelemetryRecorder';

const RELOAD_KEY = 'hhr_chunk_reload_count';
const MAX_RELOADS = 2;

const isBrowserOffline = (): boolean =>
  typeof navigator !== 'undefined' && navigator.onLine === false;

const waitForBrowserOnline = (): Promise<void> => {
  if (!isBrowserOffline() || typeof window === 'undefined') {
    return Promise.resolve();
  }

  return new Promise(resolve => {
    window.addEventListener('online', () => resolve(), { once: true });
  });
};

function isChunkLoadError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const msg = error.message.toLowerCase();
  return (
    msg.includes('loading chunk') ||
    msg.includes('dynamically imported module') ||
    msg.includes('failed to fetch') ||
    error.name === 'ChunkLoadError'
  );
}

// ComponentType<any> preserves the wrapped lazy component props; unknown erases them.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function lazyWithRetry<T extends ComponentType<any>>(
  factory: () => Promise<{ default: T }>
) {
  const load = async (): Promise<{ default: T }> => {
    try {
      return await factory();
    } catch (error) {
      if (isChunkLoadError(error)) {
        if (isBrowserOffline()) {
          recordOperationalTelemetry({
            category: 'integration',
            operation: 'chunk_load_recovery',
            status: 'degraded',
            runtimeState: 'recoverable',
            issues: ['Chunk load deferred until browser connectivity resumes.'],
          });
          await waitForBrowserOnline();
          return load();
        }

        const reloadCount = Number(sessionStorage.getItem(RELOAD_KEY) ?? '0');

        recordOperationalTelemetry({
          category: 'integration',
          operation: 'chunk_load_recovery',
          status: reloadCount < MAX_RELOADS ? 'degraded' : 'failed',
          runtimeState: 'recoverable',
          issues: [
            `Chunk load failed (attempt ${reloadCount + 1}/${MAX_RELOADS}): ${error instanceof Error ? error.message : String(error)}`,
          ],
        });

        if (reloadCount < MAX_RELOADS) {
          sessionStorage.setItem(RELOAD_KEY, String(reloadCount + 1));
          defaultBrowserWindowRuntime.reload();
          // Never resolves — page reloads before this returns
          return new Promise<never>(() => {});
        }

        // Budget exhausted — clear counter and let the error propagate to the error boundary
        sessionStorage.removeItem(RELOAD_KEY);
      }
      throw error;
    }
  };

  return lazy(load);
}
