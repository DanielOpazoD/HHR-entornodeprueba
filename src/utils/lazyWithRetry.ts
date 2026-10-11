/**
 * Lazy component loader with automatic recovery from chunk load errors.
 *
 * A missing chunk must not reload an editable workspace automatically. Offline
 * failures wait for connectivity and retry; persistent failures expose an explicit
 * recovery action while preserving the surrounding interface.
 */

import { createElement, lazy, type ComponentProps, type ComponentType } from 'react';
import { defaultBrowserWindowRuntime } from '@/shared/runtime/browserWindowRuntimeCore';
import { recordOperationalTelemetry } from '@/services/observability/operationalTelemetryRecorder';

const ChunkLoadFailure = () =>
  createElement(
    'div',
    {
      role: 'alert',
      className: 'rounded border border-amber-200 bg-amber-50 p-2 text-sm text-amber-900',
    },
    createElement(
      'p',
      null,
      'No se pudo cargar esta sección. Guarda tus cambios antes de recargar.'
    ),
    createElement(
      'button',
      {
        type: 'button',
        className: 'mt-1 underline',
        onClick: () => {
          if (
            defaultBrowserWindowRuntime.confirm(
              'Recargar la aplicación puede descartar cambios sin guardar. ¿Quieres continuar?'
            )
          ) {
            defaultBrowserWindowRuntime.reload();
          }
        },
      },
      'Recargar aplicación'
    )
  );

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
  const load = async (): Promise<{ default: ComponentType<ComponentProps<T>> }> => {
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

        recordOperationalTelemetry({
          category: 'integration',
          operation: 'chunk_load_recovery',
          status: 'failed',
          runtimeState: 'recoverable',
          issues: ['Chunk unavailable; automatic reload suppressed to preserve unsaved work.'],
        });
        return { default: ChunkLoadFailure };
      }
      throw error;
    }
  };

  return lazy(load);
}
