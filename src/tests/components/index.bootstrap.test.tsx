import { waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockReconcileBootstrapRuntime,
  mockResolveFirebaseBootstrapRuntime,
  mockInstallBootstrapRuntimeErrorListeners,
  mockRecordBootstrapRuntimeError,
  mockRecordBootstrapRuntimeResult,
  mockGetFirebaseStartupFailureMessage,
  mockResolvePreMountLoadingScreenDecision,
  mockMountFirebaseConfigWarning,
  mockHasActiveFirebaseSession,
  mockHasPersistedFirebaseAuthHint,
  mockHasRecentAuthenticatedSessionHint,
  mockPreloadAuthenticatedRouteChunk,
  mockPreloadAuthenticatedShellChunk,
  mockShouldPreloadAuthenticatedShellForPathname,
  mockCreateRoot,
  mockRootRender,
  mockDetachBootstrapRuntimeErrorListeners,
  mockBootLoggerInfo,
  mockBootLoggerError,
} = vi.hoisted(() => ({
  mockReconcileBootstrapRuntime: vi.fn(),
  mockResolveFirebaseBootstrapRuntime: vi.fn(),
  mockInstallBootstrapRuntimeErrorListeners: vi.fn(),
  mockRecordBootstrapRuntimeError: vi.fn(),
  mockRecordBootstrapRuntimeResult: vi.fn(),
  mockGetFirebaseStartupFailureMessage: vi.fn(),
  mockResolvePreMountLoadingScreenDecision: vi.fn(),
  mockMountFirebaseConfigWarning: vi.fn(),
  mockHasActiveFirebaseSession: vi.fn(),
  mockHasPersistedFirebaseAuthHint: vi.fn(),
  mockHasRecentAuthenticatedSessionHint: vi.fn(),
  mockPreloadAuthenticatedRouteChunk: vi.fn(),
  mockPreloadAuthenticatedShellChunk: vi.fn(),
  mockShouldPreloadAuthenticatedShellForPathname: vi.fn(),
  mockCreateRoot: vi.fn(),
  mockRootRender: vi.fn(),
  mockDetachBootstrapRuntimeErrorListeners: vi.fn(),
  mockBootLoggerInfo: vi.fn(),
  mockBootLoggerError: vi.fn(),
}));

vi.mock('react-dom/client', () => ({
  default: {
    createRoot: (...args: unknown[]) => mockCreateRoot(...args),
  },
  createRoot: (...args: unknown[]) => mockCreateRoot(...args),
}));

vi.mock('@/app-shell/bootstrap/bootstrapAppRuntime', () => ({
  reconcileBootstrapRuntime: (...args: unknown[]) => mockReconcileBootstrapRuntime(...args),
  resolveFirebaseBootstrapRuntime: (...args: unknown[]) =>
    mockResolveFirebaseBootstrapRuntime(...args),
}));

vi.mock('@/app-shell/bootstrap/bootstrapRuntimeTelemetry', () => ({
  installBootstrapRuntimeErrorListeners: (...args: unknown[]) =>
    mockInstallBootstrapRuntimeErrorListeners(...args),
  recordBootstrapRuntimeError: (...args: unknown[]) => mockRecordBootstrapRuntimeError(...args),
  recordBootstrapRuntimeResult: (...args: unknown[]) => mockRecordBootstrapRuntimeResult(...args),
}));

vi.mock('@/services/auth/firebaseStartupUiPolicy', () => ({
  getFirebaseStartupFailureMessage: (...args: unknown[]) =>
    mockGetFirebaseStartupFailureMessage(...args),
}));

vi.mock('@/components/ui/InitialLoadingScreen', () => ({
  InitialLoadingScreen: ({ preferLoginShell }: { preferLoginShell?: boolean }) => (
    <div data-testid="pre-mount-loading-screen" data-prefer-login-shell={preferLoginShell} />
  ),
}));

vi.mock('@/app-shell/bootstrap/BootstrapCensusChrome', () => {
  const MockBootstrapRouteChrome = () => <div data-testid="bootstrap-route-chrome" />;
  return {
    BootstrapRouteChrome: MockBootstrapRouteChrome,
  };
});

vi.mock('@/services/auth/authFallback', () => ({
  hasActiveFirebaseSession: (...args: unknown[]) => mockHasActiveFirebaseSession(...args),
}));

vi.mock('@/services/auth/authStorageHints', () => ({
  hasPersistedFirebaseAuthHint: (...args: unknown[]) => mockHasPersistedFirebaseAuthHint(...args),
  hasRecentAuthenticatedSessionHint: (...args: unknown[]) =>
    mockHasRecentAuthenticatedSessionHint(...args),
}));

vi.mock('@/app-shell/bootstrap/appShellLoadingPolicy', () => ({
  resolvePreMountLoadingScreenDecision: (...args: unknown[]) =>
    mockResolvePreMountLoadingScreenDecision(...args),
}));

vi.mock('@/app-shell/bootstrap/authenticatedRoutePreloadController', () => ({
  preloadAuthenticatedRouteChunk: (...args: unknown[]) =>
    mockPreloadAuthenticatedRouteChunk(...args),
  preloadAuthenticatedShellChunk: (...args: unknown[]) =>
    mockPreloadAuthenticatedShellChunk(...args),
  shouldPreloadAuthenticatedShellForPathname: (...args: unknown[]) =>
    mockShouldPreloadAuthenticatedShellForPathname(...args),
}));

vi.mock('@/services/firebase-runtime/firebaseStartupDiagnostics', () => ({
  mountFirebaseConfigWarning: (...args: unknown[]) => mockMountFirebaseConfigWarning(...args),
}));

vi.mock('@/services/utils/loggerScope', async () => {
  const { createLoggerScopeMock } = await import('@/tests/utils/loggerScopeMock');
  return createLoggerScopeMock({
    error: mockBootLoggerError,
    info: mockBootLoggerInfo,
  });
});

vi.mock('@/App', () => ({
  default: () => <div data-testid="mock-app">Mock App</div>,
}));

const flushBootstrapWork = async () => {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
};

describe('index bootstrap entrypoint', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();

    document.body.innerHTML = '<div id="root"></div>';

    mockRootRender.mockReset();
    mockDetachBootstrapRuntimeErrorListeners.mockReset();
    mockCreateRoot.mockReturnValue({
      render: mockRootRender,
    });
    mockInstallBootstrapRuntimeErrorListeners.mockReturnValue(
      mockDetachBootstrapRuntimeErrorListeners
    );
    mockResolvePreMountLoadingScreenDecision.mockReturnValue({
      shouldRender: false,
      preferLoginShell: false,
      renderBootstrapRouteChrome: false,
    });
    mockHasActiveFirebaseSession.mockReturnValue(false);
    mockHasPersistedFirebaseAuthHint.mockReturnValue(false);
    mockHasRecentAuthenticatedSessionHint.mockReturnValue(false);
    mockPreloadAuthenticatedRouteChunk.mockResolvedValue(undefined);
    mockPreloadAuthenticatedShellChunk.mockResolvedValue(undefined);
    mockShouldPreloadAuthenticatedShellForPathname.mockReturnValue(false);
    mockGetFirebaseStartupFailureMessage.mockReturnValue('Firebase startup failed');
    mockReconcileBootstrapRuntime.mockResolvedValue({
      status: 'continue',
      reason: null,
    });
    mockResolveFirebaseBootstrapRuntime.mockResolvedValue({
      status: 'continue',
      stage: 'firebase_ready',
      clientRecovery: {
        status: 'continue',
        reason: null,
      },
      services: {
        app: { name: 'app' },
        auth: { name: 'auth' },
        db: { name: 'db' },
      },
    });

    Object.defineProperty(window, 'location', {
      configurable: true,
      value: {
        ...window.location,
        pathname: '/',
        search: '',
      },
      writable: true,
    });
  });

  it('throws immediately when the root mount point is missing', async () => {
    document.body.innerHTML = '';

    await expect(import('@/index')).rejects.toThrow('Could not find root element to mount to');
    expect(mockCreateRoot).not.toHaveBeenCalled();
  });

  it('renders the pre-mount loading screen and stops on reload outcomes', async () => {
    mockResolvePreMountLoadingScreenDecision.mockReturnValue({
      shouldRender: true,
      preferLoginShell: false,
      renderBootstrapRouteChrome: false,
    });
    mockReconcileBootstrapRuntime.mockResolvedValue({
      status: 'reload',
      reason: 'legacy-sw',
    });

    await import('@/index');
    await flushBootstrapWork();

    expect(mockCreateRoot).toHaveBeenCalledTimes(1);
    expect(mockRootRender).toHaveBeenCalledTimes(1);
    const renderElement = mockRootRender.mock.calls[0][0];
    expect(renderElement.props.children.props.pathname).toBe('/');
    expect(mockRecordBootstrapRuntimeResult).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'reload' })
    );
    expect(mockResolveFirebaseBootstrapRuntime).not.toHaveBeenCalled();
    expect(mockDetachBootstrapRuntimeErrorListeners).toHaveBeenCalledTimes(1);
  });

  it('renders the bootstrap route chrome before React app mount when requested', async () => {
    mockResolvePreMountLoadingScreenDecision.mockReturnValue({
      shouldRender: false,
      preferLoginShell: false,
      renderBootstrapRouteChrome: true,
    });
    mockReconcileBootstrapRuntime.mockResolvedValue({
      status: 'reload',
      reason: 'legacy-sw',
    });

    await import('@/index');
    await flushBootstrapWork();

    expect(mockRootRender).toHaveBeenCalledTimes(1);
    const renderElement = mockRootRender.mock.calls[0][0];
    expect(renderElement.props.children.type.name).toBe('MockBootstrapRouteChrome');
    expect(mockPreloadAuthenticatedShellChunk).toHaveBeenCalledTimes(1);
    expect(mockPreloadAuthenticatedRouteChunk).toHaveBeenCalledWith({ pathname: '/' });
    expect(mockDetachBootstrapRuntimeErrorListeners).toHaveBeenCalledTimes(1);
  });

  it('preloads authenticated shell chunks for known module paths before auth hints resolve', async () => {
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: {
        ...window.location,
        pathname: '/censo',
        search: '?date=2026-02-20',
      },
      writable: true,
    });
    mockShouldPreloadAuthenticatedShellForPathname.mockReturnValue(true);
    mockReconcileBootstrapRuntime.mockResolvedValue({
      status: 'reload',
      reason: 'test-stop',
    });

    await import('@/index');
    await flushBootstrapWork();

    expect(mockShouldPreloadAuthenticatedShellForPathname).toHaveBeenCalledWith('/censo');
    expect(mockPreloadAuthenticatedShellChunk).toHaveBeenCalledTimes(1);
    expect(mockPreloadAuthenticatedRouteChunk).toHaveBeenCalledWith({ pathname: '/censo' });
    expect(mockRootRender).not.toHaveBeenCalled();
  });

  it('mounts the firebase startup warning when bootstrap is blocked', async () => {
    mockResolveFirebaseBootstrapRuntime.mockResolvedValue({
      status: 'blocked',
      stage: 'firebase_ready',
      message: 'No se pudo iniciar la app',
      warningCopy: {
        title: 'Configuracion faltante',
        summary: 'Falta algo',
        steps: ['Paso 1'],
      },
      clientRecovery: {
        status: 'continue',
        reason: null,
      },
    });

    await import('@/index');
    await flushBootstrapWork();

    await waitFor(() => {
      expect(mockRootRender).toHaveBeenCalled();
    });
    expect(mockMountFirebaseConfigWarning).toHaveBeenCalledWith('No se pudo iniciar la app', {
      title: 'Configuracion faltante',
      summary: 'Falta algo',
      steps: ['Paso 1'],
    });
    expect(mockDetachBootstrapRuntimeErrorListeners).toHaveBeenCalledTimes(1);
  });

  it('renders the application after client recovery before firebase runtime settles', async () => {
    let resolveFirebaseRuntime!: (value: unknown) => void;
    mockResolveFirebaseBootstrapRuntime.mockReturnValue(
      new Promise(resolve => {
        resolveFirebaseRuntime = resolve;
      })
    );

    await import('@/index');
    await flushBootstrapWork();

    expect(mockBootLoggerInfo).toHaveBeenCalledWith('Rendering application');
    await waitFor(() => {
      expect(
        mockRootRender.mock.calls.some(
          ([renderElement]) => typeof renderElement.props.children.type === 'function'
        )
      ).toBe(true);
    });
    expect(mockMountFirebaseConfigWarning).not.toHaveBeenCalled();
    expect(mockDetachBootstrapRuntimeErrorListeners).not.toHaveBeenCalled();

    resolveFirebaseRuntime({
      status: 'continue',
      stage: 'firebase_ready',
      clientRecovery: {
        status: 'continue',
        reason: null,
      },
      services: {
        app: { name: 'app' },
        auth: { name: 'auth' },
        db: { name: 'db' },
      },
    });
    await flushBootstrapWork();

    expect(mockDetachBootstrapRuntimeErrorListeners).toHaveBeenCalledTimes(1);
  });

  it('mounts the app-shell load warning for chunk-load bootstrap failures', async () => {
    const failure = new Error('Failed to fetch dynamically imported module: /assets/app.js');
    mockReconcileBootstrapRuntime.mockRejectedValue(failure);

    await import('@/index');
    await flushBootstrapWork();

    expect(mockRecordBootstrapRuntimeError).toHaveBeenCalledWith(failure);
    expect(mockMountFirebaseConfigWarning).toHaveBeenCalledWith(
      'No se pudo cargar una parte crítica de la interfaz.',
      expect.objectContaining({
        title: 'No se pudo completar el arranque',
      })
    );
    expect(mockDetachBootstrapRuntimeErrorListeners).toHaveBeenCalledTimes(1);
  });

  it('mounts the generic firebase startup warning for non-chunk bootstrap failures', async () => {
    const failure = new Error('firebase runtime exploded');
    mockReconcileBootstrapRuntime.mockRejectedValue(failure);

    await import('@/index');
    await flushBootstrapWork();

    expect(mockBootLoggerError).toHaveBeenCalledWith('Firebase initialization failed', failure);
    expect(mockMountFirebaseConfigWarning).toHaveBeenCalledWith('Firebase startup failed');
    expect(mockDetachBootstrapRuntimeErrorListeners).toHaveBeenCalledTimes(1);
  });
});
