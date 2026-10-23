import React, { useCallback, useState } from 'react';
import { GoogleIdentitySignIn } from './GoogleIdentitySignIn';
import { AlertCircle, Loader2, RefreshCw } from 'lucide-react';

import { useConfirmDialog } from '@/context/UIContext';
import { LoginCardFrame } from '@/components/ui/LoginScreenLayout';
import { AUTH_UI_COPY } from '@/services/auth/authUiCopy';
import { defaultBrowserWindowRuntime } from '@/shared/runtime/browserWindowRuntimeCore';
import NursingAccessForm from './NursingAccessForm';

interface LoginPageCardProps {
  onIndividualLoginSuccess?: () => void;
  onIndividualBusyChange?: (busy: boolean) => void;
  isDayGradient: boolean;
  isAnyLoading: boolean;
  isGoogleLoading: boolean;
  error: string | null;
  errorCode: string | null;
  canRetryGoogleSignIn?: boolean;
  onGoogleSignIn: () => void | Promise<void>;
  onGoogleCredential?: (idToken: string, isCurrent: () => boolean) => Promise<void>;
}

const GoogleIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <path
      d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
      fill="#4285F4"
    />
    <path
      d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
      fill="#34A853"
    />
    <path
      d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
      fill="#FBBC05"
    />
    <path
      d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
      fill="#EA4335"
    />
  </svg>
);

export const LoginPageCard: React.FC<LoginPageCardProps> = ({
  onIndividualLoginSuccess,
  onIndividualBusyChange,
  isAnyLoading,
  isGoogleLoading,
  error,
  errorCode,
  canRetryGoogleSignIn = false,
  onGoogleSignIn,
  onGoogleCredential,
}) => {
  const { confirm } = useConfirmDialog();
  const [isReloading, setIsReloading] = useState(false);
  const [reloadError, setReloadError] = useState<string | null>(null);
  const locked = isAnyLoading || isGoogleLoading || isReloading;
  const [showIdentity, setShowIdentity] = useState(
    Boolean(onGoogleCredential && import.meta.env.VITE_GOOGLE_SIGN_IN_CLIENT_ID)
  );
  const useFallback = useCallback(() => setShowIdentity(false), []);
  const handleReload = async () => {
    if (locked) return;
    setIsReloading(true);
    setReloadError(null);
    try {
      const confirmed = await confirm({
        title: AUTH_UI_COPY.reloadApplicationAction,
        message: AUTH_UI_COPY.reloadApplicationConfirm,
        confirmText: AUTH_UI_COPY.reloadApplicationAction,
        cancelText: 'Volver',
        variant: 'info',
      });
      if (!confirmed) return;
      defaultBrowserWindowRuntime.reload();
    } catch {
      setReloadError(
        'No se pudo recargar. Inténtalo nuevamente o usa el botón de recarga del navegador.'
      );
    } finally {
      setIsReloading(false);
    }
  };

  return (
    <LoginCardFrame>
      <div className="relative">
        <div className="space-y-4">
          {onIndividualLoginSuccess && (
            <NursingAccessForm
              onSuccess={onIndividualLoginSuccess}
              onBusyChange={onIndividualBusyChange}
              disabled={isGoogleLoading || isReloading}
            />
          )}

          <div className="flex items-start gap-4 border-t border-stone-200 pt-3">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center">
              {showIdentity && onGoogleCredential ? (
                <GoogleIdentitySignIn
                  disabled={locked}
                  onCredential={onGoogleCredential}
                  onUnavailable={useFallback}
                />
              ) : (
                <button
                  type="button"
                  onClick={() => {
                    void onGoogleSignIn();
                  }}
                  disabled={locked}
                  data-testid="login-google-button"
                  aria-label={isGoogleLoading ? 'Conectando con Google...' : 'Ingresar con Google'}
                  title="Ingresar con Google"
                  className="flex h-11 w-11 items-center justify-center rounded-full border border-stone-300 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)] transition hover:border-stone-400 hover:bg-stone-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-teal-700 disabled:cursor-wait disabled:opacity-60"
                >
                  {isGoogleLoading ? (
                    <>
                      <Loader2 className="h-5 w-5 animate-spin text-teal-800" />
                      <span className="sr-only">Conectando con Google...</span>
                    </>
                  ) : (
                    <GoogleIcon className="h-5 w-5" />
                  )}
                </button>
              )}
            </div>

            <details className="group min-w-0 flex-1 text-xs text-stone-600">
              <summary className="flex min-h-11 cursor-pointer list-none items-center justify-end gap-3 font-medium text-stone-700 marker:hidden hover:text-slate-950 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-700">
                Ayuda de acceso
                <span aria-hidden="true" className="text-base transition group-open:rotate-45">
                  +
                </span>
              </summary>
              <div className="pb-1 pt-1">
                <p className="max-w-sm leading-5 text-stone-600">
                  {AUTH_UI_COPY.reloadApplicationHint}
                </p>
                <button
                  type="button"
                  onClick={() => void handleReload()}
                  disabled={locked}
                  data-testid="login-reload-button"
                  className="mt-3 inline-flex items-center justify-center gap-2 rounded-lg border border-stone-300 bg-white px-3 py-2 text-[11px] font-semibold text-stone-700 transition hover:border-stone-400 hover:bg-stone-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-700 disabled:text-stone-400"
                >
                  <RefreshCw className={`h-3.5 w-3.5 ${isReloading ? 'animate-spin' : ''}`} />
                  {isReloading ? 'Recargando…' : AUTH_UI_COPY.reloadApplicationAction}
                </button>
                {reloadError && (
                  <p role="alert" className="mt-2 text-red-700">
                    {reloadError}
                  </p>
                )}
              </div>
            </details>
          </div>
        </div>

        {isGoogleLoading && (
          <div
            data-testid="login-google-pending"
            role="status"
            aria-live="polite"
            className="mt-4 rounded-xl border border-teal-200 bg-teal-50 px-4 py-3 text-center"
          >
            <p className="text-sm font-semibold text-teal-950">
              {showIdentity ? 'Validando tu acceso…' : AUTH_UI_COPY.popupPendingTitle}
            </p>
            <p className="mt-1 text-xs leading-5 text-teal-800 text-balance">
              {showIdentity
                ? 'Comprobando sesión y permisos de HHR.'
                : AUTH_UI_COPY.popupPendingHint}
            </p>
          </div>
        )}

        {error && (
          <div className="mt-6 animate-fade-in">
            <div
              data-testid="login-error-alert"
              data-auth-error-code={errorCode || undefined}
              role="alert"
              className="flex items-start gap-2.5 rounded-xl border border-red-200 bg-red-50 p-3 text-sm leading-5 text-red-900 text-balance"
            >
              <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0" />
              <span>{error}</span>
            </div>
            {canRetryGoogleSignIn && (
              <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-center">
                <p className="text-xs leading-5 text-amber-900 text-balance">
                  {AUTH_UI_COPY.roleValidationRetryHint}
                </p>
                <button
                  type="button"
                  onClick={() => void onGoogleSignIn()}
                  disabled={locked}
                  className="mt-3 inline-flex min-h-10 items-center justify-center rounded-lg bg-amber-600 px-4 py-2 text-xs font-semibold text-white shadow-sm transition hover:bg-amber-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-700"
                  data-testid="login-retry-button"
                >
                  {AUTH_UI_COPY.roleValidationRetryAction}
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </LoginCardFrame>
  );
};
