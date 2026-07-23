import {
  createApplicationFailed,
  createApplicationSuccess,
} from '@/shared/contracts/applicationOutcomeFactories';
import type {
  ApplicationIssue,
  ApplicationOutcome,
} from '@/shared/contracts/applicationOutcomeTypes';

import type { AuthSessionState } from '@/types/authSessionTypes';
import { signIn, signInWithGoogle, warmGoogleSignInRuntime } from '@/services/auth/authFlow';
import {
  getCurrentAuthSessionState,
  resolveCurrentAuthSessionState,
} from '@/services/auth/authSession';
import { handleSignInRedirectResult } from '@/services/auth/authFallback';
import {
  isPopupCancellationAuthError,
  isPopupRecoverableAuthError,
  resolveAuthErrorCode,
} from '@/services/auth/authErrorPolicy';
import { toResolvedAuthSessionState } from '@/services/auth/authSessionState';
import {
  normalizeCredentialSignInInput,
  validateCredentialSignInInput,
} from './authSessionContracts';

type AuthErrorSessionState = Extract<AuthSessionState, { status: 'auth_error' }>;

const resolveAuthIssueSeverity = (
  severity: ApplicationIssue['severity'] | AuthErrorSessionState['error']['severity']
): 'info' | 'warning' | 'error' => {
  if (severity === 'info' || severity === 'warning') {
    return severity;
  }

  return 'error';
};

const toAuthErrorMetadata = (issue: ApplicationIssue) => ({
  reason: issue.code,
  userSafeMessage: issue.userSafeMessage,
  retryable: issue.retryable,
  severity: resolveAuthIssueSeverity(issue.severity),
  technicalContext: issue.technicalContext,
  telemetryTags: issue.telemetryTags,
});

const toAuthErrorStateFromIssue = (issue: ApplicationIssue): AuthErrorSessionState => ({
  status: 'auth_error',
  user: null,
  error: {
    code: issue.code,
    message: issue.message,
    userSafeMessage: issue.userSafeMessage,
    retryable: issue.retryable,
    severity: resolveAuthIssueSeverity(issue.severity),
    technicalContext: issue.technicalContext,
    telemetryTags: issue.telemetryTags,
  },
});

const toAuthIssueFromSessionState = (sessionState: AuthErrorSessionState): ApplicationIssue => ({
  kind: 'unknown',
  code: sessionState.error.code,
  message: sessionState.error.message,
  userSafeMessage: sessionState.error.userSafeMessage,
  retryable: sessionState.error.retryable,
  severity: resolveAuthIssueSeverity(sessionState.error.severity),
  technicalContext: sessionState.error.technicalContext,
  telemetryTags: sessionState.error.telemetryTags,
});

const buildAuthIssue = (
  error: unknown,
  fallbackCode: string,
  fallbackMessage: string
): ApplicationIssue => {
  const code = resolveAuthErrorCode(error) || fallbackCode;
  const message = error instanceof Error ? error.message || fallbackMessage : fallbackMessage;
  const retryable = isPopupRecoverableAuthError(error) || isPopupCancellationAuthError(error);
  return {
    kind: 'unknown',
    code,
    message,
    userSafeMessage: message,
    retryable,
    severity: retryable ? 'warning' : 'error',
    technicalContext: {
      errorName: error instanceof Error ? error.name : typeof error,
    },
    telemetryTags: ['auth', code],
  };
};

const buildAuthFailure = (
  error: unknown,
  fallbackCode: string,
  fallbackMessage: string
): ApplicationOutcome<AuthSessionState> => {
  const issue = buildAuthIssue(error, fallbackCode, fallbackMessage);
  return createApplicationFailed(
    toAuthErrorStateFromIssue(issue),
    [issue],
    toAuthErrorMetadata(issue)
  );
};

const buildCredentialValidationFailure = (
  issues: ApplicationIssue[]
): ApplicationOutcome<AuthSessionState> => {
  const [primaryIssue] = issues;
  const issue =
    primaryIssue ||
    ({
      kind: 'validation',
      code: 'auth/credential-invalid-input',
      message: 'Credential sign-in input is invalid.',
      userSafeMessage: 'Revisa email y contraseña antes de continuar.',
      retryable: true,
      severity: 'info',
    } satisfies ApplicationIssue);

  return createApplicationFailed(toAuthErrorStateFromIssue(issue), issues, {
    ...toAuthErrorMetadata(issue),
    reason: issue.code || 'auth/credential-invalid-input',
    severity: resolveAuthIssueSeverity(issue.severity),
  });
};

export const executeGoogleSignInWarmup = (): void => {
  warmGoogleSignInRuntime();
};

export const executeGoogleSignIn = async (): Promise<ApplicationOutcome<AuthSessionState>> => {
  try {
    const user = await signInWithGoogle();
    return createApplicationSuccess(toResolvedAuthSessionState(user));
  } catch (error) {
    return buildAuthFailure(
      error,
      'auth/google-signin-failed',
      'Error al iniciar sesión con Google'
    );
  }
};

export const executeCredentialSignIn = async (
  email: string,
  password: string
): Promise<ApplicationOutcome<AuthSessionState>> => {
  const normalizedInput = normalizeCredentialSignInInput({ email, password });
  const inputIssues = validateCredentialSignInInput(normalizedInput);
  if (inputIssues.length > 0) {
    return buildCredentialValidationFailure(inputIssues);
  }

  try {
    const user = await signIn(normalizedInput.email, normalizedInput.password);
    return createApplicationSuccess(toResolvedAuthSessionState(user));
  } catch (error) {
    return buildAuthFailure(error, 'auth/credential-signin-failed', 'Error de autenticación');
  }
};

export const executeRedirectAuthResolution = async (): Promise<
  ApplicationOutcome<AuthSessionState | null>
> => {
  const sessionState = await handleSignInRedirectResult();
  if (!sessionState) {
    return createApplicationSuccess(null);
  }

  if (sessionState.status === 'auth_error') {
    const issue = toAuthIssueFromSessionState(sessionState);
    return createApplicationFailed(sessionState, [issue], toAuthErrorMetadata(issue));
  }

  return createApplicationSuccess(sessionState);
};

export const executeCurrentAuthSessionState = (): ApplicationOutcome<AuthSessionState> =>
  createApplicationSuccess(getCurrentAuthSessionState());

export const executeResolvedCurrentAuthSessionState = async (): Promise<
  ApplicationOutcome<AuthSessionState | null>
> => {
  const sessionState = await resolveCurrentAuthSessionState();
  if (sessionState.status === 'unauthenticated') {
    return createApplicationSuccess(null);
  }

  if (sessionState.status === 'auth_error') {
    const issue = toAuthIssueFromSessionState(sessionState);
    return createApplicationFailed(sessionState, [issue], toAuthErrorMetadata(issue));
  }

  return createApplicationSuccess(sessionState);
};
