/**
 * App.tsx - Main Application Component
 *
 * Coordinates bootstrap state, authenticated runtime wiring, and global providers.
 */

import React from 'react';
import { LoginPage } from '@/features/auth/public';
import { GlobalErrorBoundary } from '@/components/shared/GlobalErrorBoundary';
import { VersionProvider } from '@/context/VersionContext';
import { VersionMismatchOverlay } from '@/components/shared/VersionMismatchOverlay';
import { InitialLoadingScreen } from '@/components/ui/InitialLoadingScreen';
import { ViewLoader } from '@/components/ui/ViewLoader';
import { BootstrapRouteChrome } from '@/app-shell/bootstrap/BootstrapCensusChrome';
import {
  DocumentScannerDemoView,
  DocumentScannerLocalQueueView,
  DocumentScannerQueueView,
  MedicalSignatureView,
  PrescriptionAdminView,
  PrescriptionUploadView,
  PrescriptionVisorView,
  WoundCareMobileUploadView,
} from '@/views/LazyViews';
import { resolveRuntimeLoadingScreenMode } from '@/app-shell/bootstrap/appShellLoadingPolicy';
import { AuditProvider } from '@/context/AuditContext';
import { AuthProvider } from '@/context/AuthContext';
import { UIProvider } from '@/context/UIContext';
import { HospitalProvider } from './context/HospitalContext';
import { DefaultRepositoryProvider } from '@/services/RepositoryContext';
import { QueryClientProvider } from '@tanstack/react-query';
import { queryClient } from '@/config/queryClient';
import { useAppBootstrapState } from '@/app-shell/bootstrap/useAppBootstrapState';
import { lazyWithRetry } from '@/utils/lazyWithRetry';
import { markPerf } from '@/shared/runtime/perfAudit';

const AuthenticatedAppShell = lazyWithRetry(() =>
  import('@/app-shell/runtime/AuthenticatedAppShell').then(module => ({
    default: module.AuthenticatedAppShell,
  }))
);

const VersionedAppShell = ({ children }: { children: React.ReactNode }) => (
  <VersionProvider>
    <VersionMismatchOverlay />
    {children}
  </VersionProvider>
);

const resolveLoginInitialAuthError = (
  auth: ReturnType<typeof useAppBootstrapState>['auth']
): { message: string; code?: string | null } | null => {
  if (auth.sessionState.status === 'auth_error') {
    return {
      message:
        auth.sessionState.error.userSafeMessage ||
        auth.sessionState.error.message ||
        'No fue posible completar el ingreso con Google.',
      code: auth.sessionState.error.code,
    };
  }

  if (auth.sessionState.status === 'unauthorized') {
    return {
      message:
        auth.sessionState.reason ||
        'Tu cuenta no tiene autorizacion para ingresar a esta aplicacion.',
      code: 'auth/unauthorized',
    };
  }

  return null;
};

function App() {
  const bootstrapState = useAppBootstrapState();
  markPerf('app:first-render');
  React.useEffect(() => {
    if (bootstrapState.status === 'authenticated') {
      markPerf('auth:ready');
    }
  }, [bootstrapState.status]);

  const pathname = typeof window !== 'undefined' ? window.location.pathname : '/';
  const isWoundCareMobileUploadRoute = pathname.startsWith('/wound-care/mobile-upload/');
  const isPrescriptionsUploadRoute = pathname.startsWith('/recetas/upload');
  const isPrescriptionsVisorRoute = pathname.startsWith('/recetas/visor');
  const isPrescriptionsAdminRoute = pathname.startsWith('/admin/recetas-config');
  const isDocumentScannerDemoRoute =
    pathname === '/documentos/escanear-demo' || pathname.startsWith('/documentos/escanear-demo/');
  const isDocumentScannerQueueRoute =
    pathname === '/documentos/pendientes' || pathname.startsWith('/documentos/pendientes/');
  const isDocumentScannerLocalQueueRoute =
    import.meta.env.DEV && pathname.startsWith('/documentos/pendientes-local');
  const loadingScreenMode =
    bootstrapState.status === 'loading'
      ? resolveRuntimeLoadingScreenMode({
          pathname,
          bootstrapState,
        })
      : null;

  if (isWoundCareMobileUploadRoute) {
    return (
      <VersionedAppShell>
        <React.Suspense fallback={<ViewLoader />}>
          <WoundCareMobileUploadView />
        </React.Suspense>
      </VersionedAppShell>
    );
  }

  if (isPrescriptionsUploadRoute) {
    return (
      <VersionedAppShell>
        <React.Suspense fallback={<ViewLoader />}>
          <PrescriptionUploadView />
        </React.Suspense>
      </VersionedAppShell>
    );
  }

  if (isDocumentScannerDemoRoute) {
    return (
      <VersionedAppShell>
        <React.Suspense fallback={<ViewLoader />}>
          <DocumentScannerDemoView />
        </React.Suspense>
      </VersionedAppShell>
    );
  }

  if (isDocumentScannerLocalQueueRoute) {
    return (
      <VersionedAppShell>
        <React.Suspense fallback={<ViewLoader />}>
          <DocumentScannerLocalQueueView />
        </React.Suspense>
      </VersionedAppShell>
    );
  }

  if (bootstrapState.status === 'signature_mode') {
    return (
      <VersionedAppShell>
        <React.Suspense fallback={<ViewLoader />}>
          <MedicalSignatureView />
        </React.Suspense>
      </VersionedAppShell>
    );
  }

  if (bootstrapState.status === 'loading') {
    if (loadingScreenMode === 'bootstrap-route-chrome') {
      return <BootstrapRouteChrome />;
    }

    if (loadingScreenMode === 'silent') {
      return null;
    }

    return (
      <InitialLoadingScreen
        pathname={pathname}
        preferLoginShell={loadingScreenMode === 'login-shell'}
      />
    );
  }

  if (bootstrapState.status === 'unauthenticated') {
    return (
      <LoginPage
        onLoginSuccess={() => {}}
        initialAuthError={resolveLoginInitialAuthError(bootstrapState.auth)}
      />
    );
  }

  if (isPrescriptionsVisorRoute) {
    return (
      <VersionedAppShell>
        <React.Suspense fallback={<ViewLoader />}>
          <PrescriptionVisorView />
        </React.Suspense>
      </VersionedAppShell>
    );
  }

  if (isPrescriptionsAdminRoute) {
    return (
      <VersionedAppShell>
        <React.Suspense fallback={<ViewLoader />}>
          <PrescriptionAdminView />
        </React.Suspense>
      </VersionedAppShell>
    );
  }

  if (isDocumentScannerQueueRoute) {
    return (
      <VersionedAppShell>
        <React.Suspense fallback={<ViewLoader />}>
          <DocumentScannerQueueView />
        </React.Suspense>
      </VersionedAppShell>
    );
  }

  return (
    <VersionedAppShell>
      <React.Suspense fallback={<BootstrapRouteChrome />}>
        <AuthenticatedAppShell auth={bootstrapState.auth} dateNav={bootstrapState.dateNav} />
      </React.Suspense>
    </VersionedAppShell>
  );
}

const AppWithErrorBoundary = () => {
  return (
    <GlobalErrorBoundary>
      <App />
    </GlobalErrorBoundary>
  );
};

export default function ProvidedApp() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <DefaultRepositoryProvider>
          <HospitalProvider>
            <UIProvider>
              <AuditProvider>
                <AppWithErrorBoundary />
              </AuditProvider>
            </UIProvider>
          </HospitalProvider>
        </DefaultRepositoryProvider>
      </AuthProvider>
    </QueryClientProvider>
  );
}
