import React, { lazy, Suspense, useCallback, useState } from 'react';
import { GoogleIdentitySignIn } from './GoogleIdentitySignIn';
import { AlertCircle, Loader2, RotateCcw } from 'lucide-react';

import { useConfirmDialog } from '@/context/UIContext';
import { LoginCardFrame, LoginCredentialsPlaceholder } from '@/components/ui/LoginScreenLayout';
import { AUTH_UI_COPY } from '@/services/auth/authUiCopy';
import { resetLocalAppStorage } from '@/services/storage/indexeddb/indexedDbMaintenanceService';

const NursingAccessForm = lazy(() => import('./NursingAccessForm'));

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
  onLocalResetStart?: () => void;
}

const GoogleIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg className={className} viewBox="0 0 24 24" fill="currentColor">
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
  onLocalResetStart,
}) => {
  const { confirm } = useConfirmDialog();
  const [showIdentity, setShowIdentity] = useState(
    Boolean(onGoogleCredential && import.meta.env.VITE_GOOGLE_SIGN_IN_CLIENT_ID)
  );
  const useFallback = useCallback(() => setShowIdentity(false), []);
  const handleResetLocalSession = async () => {
    const confirmed = await confirm({
      title: AUTH_UI_COPY.resetStorageTitle,
      message: AUTH_UI_COPY.resetStorageConfirm,
      confirmText: AUTH_UI_COPY.resetStorageConfirmAction,
      cancelText: 'Volver',
      variant: 'info',
    });

    if (confirmed) {
      onLocalResetStart?.();
      await resetLocalAppStorage();
    }
  };

  return (
    <LoginCardFrame>
      <div className="relative">
        <div className="space-y-3">
          {onIndividualLoginSuccess && (
            <Suspense fallback={<LoginCredentialsPlaceholder />}>
              <NursingAccessForm
                onSuccess={onIndividualLoginSuccess}
                onBusyChange={onIndividualBusyChange}
                disabled={isGoogleLoading}
              />
            </Suspense>
          )}

          <div className="mt-4 flex items-center justify-between border-t border-white/15 pt-3">
            <details className="text-xs text-white/75">
              <summary className="cursor-pointer py-2 hover:text-white">Ayuda de acceso</summary>
              <p className="mt-2 max-w-52 leading-relaxed">
                Si el acceso no responde, puedes revisar las opciones de reinicio local.
              </p>
              <button
                type="button"
                onClick={() => void handleResetLocalSession()}
                disabled={isAnyLoading}
                data-testid="login-reset-local-button"
                className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-white/20 bg-white/5 px-2.5 py-1.5 text-[11px] font-medium text-white/70 backdrop-blur-sm transition hover:bg-white/15 hover:text-white disabled:text-white/40"
              >
                <RotateCcw className="h-3 w-3" />
                {AUTH_UI_COPY.resetStorageAction}
              </button>
            </details>
            {showIdentity && onGoogleCredential ? (
              <GoogleIdentitySignIn
                disabled={isAnyLoading}
                onCredential={onGoogleCredential}
                onUnavailable={useFallback}
              />
            ) : (
              <button
                type="button"
                onClick={() => {
                  void onGoogleSignIn();
                }}
                disabled={isAnyLoading}
                data-testid="login-google-button"
                aria-label={isGoogleLoading ? 'Conectando con Google...' : 'Ingresar con Google'}
                title="Ingresar con Google"
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-white/60 bg-white shadow-sm transition hover:bg-slate-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-white disabled:opacity-50"
              >
                {isGoogleLoading ? (
                  <>
                    <Loader2 className="h-6 w-6 animate-spin text-medical-600" />
                    <span className="sr-only">Conectando con Google...</span>
                  </>
                ) : (
                  <>
                    <GoogleIcon className="h-6 w-6" />
                    <span className="sr-only">Ingresar con Google</span>
                  </>
                )}
              </button>
            )}
          </div>
        </div>

        {isGoogleLoading && (
          <div
            data-testid="login-google-pending"
            role="status"
            aria-live="polite"
            className="mt-5 rounded-2xl border border-white/25 bg-white/10 px-4 py-3 text-center backdrop-blur-md"
          >
            <p className="text-sm font-semibold text-white">
              {showIdentity ? 'Validando tu acceso…' : AUTH_UI_COPY.popupPendingTitle}
            </p>
            <p className="mt-1 text-xs text-white/80 text-balance">
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
              className="flex items-center gap-2 rounded-xl border border-red-300/50 bg-red-500/20 p-3 text-sm text-red-50 text-balance backdrop-blur-md"
            >
              <AlertCircle className="h-5 w-5 flex-shrink-0" />
              <span>{error}</span>
            </div>
            {canRetryGoogleSignIn && (
              <div className="mt-3 rounded-2xl border border-amber-300/40 bg-amber-500/15 px-4 py-3 text-center backdrop-blur-md">
                <p className="text-xs text-amber-50 text-balance">
                  {AUTH_UI_COPY.roleValidationRetryHint}
                </p>
                <button
                  type="button"
                  onClick={() => void onGoogleSignIn()}
                  className="mt-3 inline-flex items-center justify-center rounded-xl bg-amber-500 px-4 py-2 text-xs font-semibold uppercase tracking-[0.12em] text-white shadow-lg shadow-amber-900/40 transition hover:bg-amber-400"
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
