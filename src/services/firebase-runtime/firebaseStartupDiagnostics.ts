import type { FirebaseOptions } from 'firebase/app';
import {
  getFirebaseAuthConfigStatus,
  getFirebaseRuntimeConfigDiagnostics,
  type FirebaseRuntimeConfigDiagnostics,
} from '@/services/auth/firebaseAuthConfigPolicy';
import {
  getFirebaseStartupFailureMessage,
  getFirebaseStartupWarningCopy,
} from '@/services/auth/firebaseStartupUiPolicy';
import { mountFirebaseConfigWarning } from '@/services/auth/firebaseStartupWarningRenderer';
import { firebaseStartupDiagnosticsLogger } from '@/services/firebase-runtime/firebaseRuntimeLoggers';

export const warnWithFirebaseDiagnostics = (
  diagnostics: FirebaseRuntimeConfigDiagnostics,
  fallbackMessage?: string
) => {
  mountFirebaseConfigWarning(
    fallbackMessage || getFirebaseStartupFailureMessage(diagnostics),
    getFirebaseStartupWarningCopy(diagnostics)
  );
};

export const warnOnFirebaseAuthConfig = (config: FirebaseOptions) => {
  const authConfigStatus = getFirebaseAuthConfigStatus(config.authDomain);

  if (!authConfigStatus.hasAuthDomain) {
    firebaseStartupDiagnosticsLogger.info(
      `[FirebaseConfig] ⚠️ ${authConfigStatus.supportSummary} ${authConfigStatus.supportAction}`
    );
    return;
  }

  if (!authConfigStatus.usesFirebaseHostedAuthDomain) {
    firebaseStartupDiagnosticsLogger.info(
      `[FirebaseConfig] ⚠️ ${authConfigStatus.supportSummary} ${authConfigStatus.supportAction}`
    );
  }
};

export const validateFirebaseRuntimeConfig = (config: FirebaseOptions) => {
  const diagnostics = getFirebaseRuntimeConfigDiagnostics(config);
  if (diagnostics.hasBlockingIssue) {
    warnWithFirebaseDiagnostics(diagnostics);
    throw new Error(getFirebaseStartupFailureMessage(diagnostics));
  }
};

export { mountFirebaseConfigWarning };
