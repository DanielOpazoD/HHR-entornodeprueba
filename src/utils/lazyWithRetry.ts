/**
 * Lazy component loader with automatic recovery from chunk load errors.
 *
 * A missing chunk must not reload an editable workspace automatically. Offline
 * failures wait for connectivity and retry; persistent failures expose an explicit
 * recovery action while preserving the surrounding interface.
 *
 * `preload()` starts the same single load ahead of the first render. Once it settles, the
 * component renders without suspending: a Suspense fallback that was shown makes React hold the
 * reveal of the real content for 300 ms, so on-demand dialogs open faster when they wait for it.
 */

import { createElement, lazy, type ComponentProps, type ComponentType } from 'react';
import { isChunkLoadError } from '@/utils/chunkLoadError';
import { defaultBrowserWindowRuntime } from '@/shared/runtime/browserWindowRuntimeCore';
import { recordOperationalTelemetry } from '@/services/observability/operationalTelemetryRecorder';

export const reloadAfterChunkLoadFailure = () => {
  if (
    defaultBrowserWindowRuntime.confirm(
      'Recargar la aplicación puede descartar cambios sin guardar. ¿Quieres continuar?'
    )
  ) {
    defaultBrowserWindowRuntime.reload();
  }
};

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
        onClick: reloadAfterChunkLoadFailure,
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

// ComponentType<any> preserves the wrapped lazy component props; unknown erases them.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function lazyWithRetry<T extends ComponentType<any>>(
  factory: () => Promise<{ default: T }>
) {
  type Loaded = { default: ComponentType<ComponentProps<T>> };
  const load = async (): Promise<Loaded> => {
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

  let loading: Promise<Loaded> | null = null;
  let loaded: ComponentType<ComponentProps<T>> | null = null;
  const preload = (): Promise<Loaded> =>
    (loading ??= load().then(module => {
      loaded = module.default;
      return module;
    }));
  const Lazy = lazy(preload);
  const OnDemand = (props: ComponentProps<T>) => createElement(loaded ?? Lazy, props);
  return Object.assign(OnDemand, { preload });
}
