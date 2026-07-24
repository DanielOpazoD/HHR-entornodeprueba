import { createAuthError } from '@/services/auth/authShared';

type AuthErrorLike = {
  code?: string;
  message?: string;
};

const normalize = (value: unknown): string => String(value || '').toLowerCase();

const inferCodeFromMessage = (message: string): string | null => {
  if (!message) return null;

  if (message.includes('internal assertion') || message.includes('cross-origin-opener-policy')) {
    return 'auth/popup-coop-blocked';
  }

  if (message.includes('popup blocked') || message.includes('ventana emergente')) {
    return 'auth/popup-blocked';
  }

  if (message.includes('popup timeout') || message.includes('no respondió a tiempo')) {
    return 'auth/popup-timeout';
  }

  if (message.includes('cancelled-popup-request')) {
    return 'auth/cancelled-popup-request';
  }

  if (message.includes('popup-closed-by-user')) {
    return 'auth/popup-closed-by-user';
  }

  if (message.includes('network-request-failed') || message.includes('cookies')) {
    return 'auth/network-request-failed';
  }

  return null;
};

export const resolveAuthErrorCode = (error: unknown): string | null => {
  const authError = error as AuthErrorLike;
  if (typeof authError?.code === 'string' && authError.code) {
    return authError.code;
  }

  return inferCodeFromMessage(normalize(authError?.message));
};

export const isPopupRecoverableAuthError = (error: unknown): boolean => {
  const code = resolveAuthErrorCode(error);

  return (
    code === 'auth/popup-coop-blocked' ||
    code === 'auth/popup-timeout' ||
    code === 'auth/network-request-failed' ||
    code === 'auth/popup-blocked' ||
    code === 'auth/multi-tab-login-in-progress'
  );
};

export const isPopupCancellationAuthError = (error: unknown): boolean => {
  const code = resolveAuthErrorCode(error);
  return code === 'auth/cancelled-popup-request' || code === 'auth/popup-closed-by-user';
};

/**
 * True only when the browser prevented the Google window from opening or from
 * closing safely. A slow user inside an already-open popup (auth/popup-timeout)
 * is NOT an open failure and must not be reported as a blocked popup.
 */
export const isPopupOpenFailureAuthError = (error: unknown): boolean => {
  const code = resolveAuthErrorCode(error);
  return code === 'auth/popup-blocked' || code === 'auth/popup-coop-blocked';
};

export const shouldDowngradeGoogleAuthLogLevel = (error: unknown): boolean =>
  isPopupRecoverableAuthError(error) || isPopupCancellationAuthError(error);

const GOOGLE_AUTH_ERROR_MESSAGES: Record<string, string> = {
  'auth/multi-tab-login-in-progress':
    'Ya hay otra pestaña intentando entrar. Espera unos segundos o prueba la otra forma de ingreso.',
  'auth/popup-closed-by-user': 'Inicio de sesión cancelado. Intenta nuevamente desde el botón.',
  'auth/popup-blocked':
    'El navegador no permitió abrir la ventana de Google. Revisa si bloqueó ventanas emergentes para este sitio.',
  'auth/popup-timeout':
    'El ingreso con Google está tardando más de lo esperado. Si la ventana de Google sigue abierta, puedes completar el acceso ahí; si no, inténtalo nuevamente desde el botón.',
  'auth/cancelled-popup-request': 'Inicio de sesión cancelado. Intenta nuevamente desde el botón.',
  'auth/network-request-failed':
    'No se pudo completar el ingreso por un problema de conexión o por una restricción del navegador.',
  'auth/popup-coop-blocked':
    'El navegador bloqueó el cierre seguro de la ventana de Google. Prueba la otra forma de ingreso.',
  'auth/role-validation-unavailable':
    'No se pudo validar tu acceso en este momento. Intenta nuevamente en unos segundos.',
  'auth/unauthorized-domain':
    'Este sitio todavía no está autorizado para usar el ingreso con Google. Pide que revisen la configuración de Firebase Auth.',
  'auth/invalid-api-key':
    'La configuración de acceso no es válida. Revisa las variables de Firebase del entorno.',
};

export const toGoogleAuthError = (error: unknown): Error & { code: string } => {
  const code = resolveAuthErrorCode(error) || 'auth/google-signin-failed';
  const message = GOOGLE_AUTH_ERROR_MESSAGES[code] || 'Error al iniciar sesión con Google';
  return createAuthError(code, message);
};
