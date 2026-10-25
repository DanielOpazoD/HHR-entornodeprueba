import { isChunkLoadError } from '@/utils/chunkLoadError';
import React from 'react';
import ReactDOM from 'react-dom/client';
import {
  reconcileBootstrapRuntime,
  resolveFirebaseBootstrapRuntime,
} from '@/app-shell/bootstrap/bootstrapAppRuntime';
import {
  installBootstrapRuntimeErrorListeners,
  recordBootstrapRuntimeError,
  recordBootstrapRuntimeResult,
} from '@/app-shell/bootstrap/bootstrapRuntimeTelemetry';
import {
  getFirebaseStartupFailureMessage,
  type FirebaseStartupWarningCopy,
} from '@/services/auth/firebaseStartupUiPolicy';
import { InitialLoadingScreen } from '@/components/ui/InitialLoadingScreen';
import { BootstrapRouteChrome } from '@/app-shell/bootstrap/BootstrapCensusChrome';
import { resolvePreMountLoadingScreenDecision } from '@/app-shell/bootstrap/appShellLoadingPolicy';
import {
  preloadAuthenticatedRouteChunk,
  preloadAuthenticatedShellChunk,
  shouldPreloadAuthenticatedShellForPathname,
} from '@/app-shell/bootstrap/authenticatedRoutePreloadController';
import { mountFirebaseConfigWarning } from '@/services/firebase-runtime/firebaseStartupDiagnostics';
import { createScopedLogger } from '@/services/utils/loggerScope';
import { markPerf } from '@/shared/runtime/perfAudit';

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error('Could not find root element to mount to');
}

markPerf('bootstrap:start');

const root = ReactDOM.createRoot(rootElement);
const bootLogger = createScopedLogger('Bootstrap');
const detachBootstrapRuntimeErrorListeners =
  typeof window !== 'undefined' ? installBootstrapRuntimeErrorListeners() : () => {};
const APP_SHELL_LOAD_WARNING_COPY: FirebaseStartupWarningCopy = {
  title: 'No se pudo completar el arranque',
  summary:
    'La app no logró cargar una parte crítica de la interfaz después de preparar el runtime inicial.',
  steps: [
    'Recarga la página para forzar la descarga del bundle actualizado.',
    'Si el problema persiste, limpia la caché del sitio y vuelve a intentar.',
    'Si falla en varios navegadores, revisa primero el smoke de preview y los chunks críticos del build.',
  ],
  footnote:
    'Este aviso apunta al bundle de interfaz o a la caché del navegador, no a una falta confirmada de variables Firebase.',
};

const isAppShellLoadFailure = (error: unknown): boolean => {
  const message =
    error instanceof Error
      ? error.message
      : error && typeof error === 'object' && 'message' in error
        ? String(error.message)
        : String(error);
  return isChunkLoadError(error) || /cannot access '.+' before initialization/i.test(message);
};

const renderBootstrapLoadingScreen = () => {
  const pathname = window.location.pathname;
  const loadingScreenDecision = resolvePreMountLoadingScreenDecision({
    pathname,
  });
  const shouldPreloadAuthenticatedShell =
    loadingScreenDecision.renderBootstrapRouteChrome ||
    shouldPreloadAuthenticatedShellForPathname(pathname);

  if (shouldPreloadAuthenticatedShell) {
    void preloadAuthenticatedShellChunk();
    void preloadAuthenticatedRouteChunk({ pathname });
  }

  if (loadingScreenDecision.renderBootstrapRouteChrome) {
    root.render(
      <React.StrictMode>
        <BootstrapRouteChrome />
      </React.StrictMode>
    );
    return;
  }

  if (!loadingScreenDecision.shouldRender) {
    return;
  }

  root.render(
    <React.StrictMode>
      <InitialLoadingScreen
        pathname={window.location.pathname}
        preferLoginShell={loadingScreenDecision.preferLoginShell}
      />
    </React.StrictMode>
  );
};

const renderApp = async () => {
  bootLogger.info('Rendering application');
  const { default: App } = await appModulePromise;
  root.render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  );
};

renderBootstrapLoadingScreen();

// Fetch the main app shell while bootstrap recovery/Firebase runtime settles so
// the login page is not blocked behind a second sequential chunk load.
markPerf('app-module:import-start');
const appModulePromise = import('@/App').then(module => {
  markPerf('app-module:import-done');
  return module;
});

reconcileBootstrapRuntime()
  .then(async clientRecovery => {
    if (clientRecovery.status === 'reload') {
      const result = {
        status: 'reload' as const,
        stage: 'client_recovery' as const,
        clientRecovery,
      };
      markPerf('bootstrap:runtime-ready', result.status);
      recordBootstrapRuntimeResult(result);
      return;
    }

    await renderApp();

    const result = await resolveFirebaseBootstrapRuntime(clientRecovery);
    markPerf('bootstrap:runtime-ready', result.status);
    recordBootstrapRuntimeResult(result);

    if (result.status === 'reload') {
      return;
    }

    if (result.status === 'blocked') {
      mountFirebaseConfigWarning(result.message, result.warningCopy);
      return;
    }
  })
  .catch(error => {
    recordBootstrapRuntimeError(error);
    bootLogger.error('Firebase initialization failed', error);
    if (isAppShellLoadFailure(error)) {
      mountFirebaseConfigWarning(
        'No se pudo cargar una parte crítica de la interfaz.',
        APP_SHELL_LOAD_WARNING_COPY
      );
      return;
    }

    mountFirebaseConfigWarning(getFirebaseStartupFailureMessage());
  })
  .finally(() => {
    // Keep the listeners active only through bootstrap to avoid mixing startup
    // incidents with later domain/runtime errors already captured elsewhere.
    detachBootstrapRuntimeErrorListeners();
  });
