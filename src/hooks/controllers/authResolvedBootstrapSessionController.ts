import type { AuthSessionState } from '@/types/authSessionTypes';
import {
  clearAuthBootstrapPending,
  isAuthBootstrapPending,
  restoreAuthBootstrapReturnTo,
} from '@/services/auth/authBootstrapState';
import { clearRecentManualLogout } from '@/services/auth/authLogoutState';
import { isAuthenticatedAuthSessionState } from '@/services/auth/authSessionState';
import { markRecentAuthenticatedSessionHint } from '@/services/auth/authStorageHints';
import { markPerf } from '@/shared/runtime/perfAudit';

interface ApplyResolvedBootstrapSessionStateDependencies {
  markPerf: (name: string, detail?: string) => void;
  isAuthBootstrapPending: () => boolean;
  restoreAuthBootstrapReturnTo: () => void;
  clearRecentManualLogout: () => void;
  clearAuthBootstrapPending: () => void;
  markRecentAuthenticatedSessionHint: () => void;
}

const defaultApplyResolvedBootstrapSessionStateDependencies: ApplyResolvedBootstrapSessionStateDependencies =
  {
    markPerf,
    isAuthBootstrapPending,
    restoreAuthBootstrapReturnTo,
    clearRecentManualLogout,
    clearAuthBootstrapPending,
    markRecentAuthenticatedSessionHint,
  };

export const applyResolvedBootstrapSessionState = ({
  sessionState,
  setSessionState,
  setAuthLoading,
  dependencies = defaultApplyResolvedBootstrapSessionStateDependencies,
}: {
  sessionState: AuthSessionState;
  setSessionState: (sessionState: AuthSessionState) => void;
  setAuthLoading: (value: boolean) => void;
  dependencies?: ApplyResolvedBootstrapSessionStateDependencies;
}): void => {
  dependencies.markPerf('auth-bootstrap:apply-session', sessionState.status);
  if (dependencies.isAuthBootstrapPending()) {
    dependencies.restoreAuthBootstrapReturnTo();
  }
  // The audit connection (start, resume, end) is tracked by useAuditConnectionTracker.
  if (isAuthenticatedAuthSessionState(sessionState)) {
    dependencies.clearRecentManualLogout();
    if (sessionState.status === 'authorized' && sessionState.user.email) {
      dependencies.markRecentAuthenticatedSessionHint();
    }
  }
  setSessionState(sessionState);
  setAuthLoading(false);
  dependencies.clearAuthBootstrapPending();
};
