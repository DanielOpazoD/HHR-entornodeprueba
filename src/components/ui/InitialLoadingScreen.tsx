import React from 'react';
import { Cross, Loader2 } from 'lucide-react';
import {
  resolveInitialLoginBackgroundMode,
  resolveLoginBackgroundImage,
} from '@/shared/ui/loginBackgroundModeController';

export type InitialLoadingScreenVariant = 'default' | 'login-shell';
interface InitialLoadingScreenVariantOptions {
  preferLoginShell?: boolean;
}

const normalizePathname = (pathname: string) => pathname.replace(/^\/+|\/+$/g, '');

export const resolveInitialLoadingScreenVariant = (
  pathname: string | undefined,
  options: InitialLoadingScreenVariantOptions = {}
): InitialLoadingScreenVariant => {
  const normalizedPath = normalizePathname(pathname ?? '/');
  const { preferLoginShell = true } = options;

  // Root/login keep a branded pre-auth shell so refreshes preserve the
  // recognizable login atmosphere before Firebase resolves the session.
  if (preferLoginShell && (normalizedPath === '' || normalizedPath === 'login')) {
    return 'login-shell';
  }

  return 'default';
};

const resolveCurrentPathname = () =>
  typeof window !== 'undefined' ? window.location.pathname : '/';

const LoadingIndicator = () => (
  <div className="flex flex-col items-center gap-2.5">
    <Loader2 size={28} className="animate-spin text-accent-500" />
    <span className="text-slate-400 text-xs font-medium tracking-wide">Cargando...</span>
  </div>
);

const LoginShellLoadingScreen = () => {
  const backgroundMode = resolveInitialLoginBackgroundMode();
  const backgroundImage = resolveLoginBackgroundImage(backgroundMode);
  const overlayClass =
    backgroundMode === 'day'
      ? 'bg-[linear-gradient(115deg,rgba(15,23,42,0.82)_0%,rgba(15,23,42,0.62)_36%,rgba(15,23,42,0.28)_64%,rgba(255,255,255,0.08)_100%)]'
      : 'bg-[linear-gradient(115deg,rgba(2,6,23,0.92)_0%,rgba(2,6,23,0.78)_35%,rgba(2,6,23,0.44)_66%,rgba(2,6,23,0.22)_100%)]';

  return (
    <div
      data-testid="login-loading-shell"
      data-background-mode={backgroundMode}
      data-background-image={backgroundImage}
      className="relative min-h-screen overflow-hidden bg-slate-950"
    >
      <div
        className="absolute inset-0 bg-contain bg-center bg-no-repeat"
        style={{ backgroundImage: `url('${backgroundImage}')` }}
        aria-hidden="true"
      />
      <div className={`absolute inset-0 ${overlayClass}`} aria-hidden="true" />
      <div
        className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(255,255,255,0.18),transparent_32%),radial-gradient(circle_at_bottom_right,rgba(14,165,233,0.14),transparent_26%)]"
        aria-hidden="true"
      />

      <div className="relative z-10 flex min-h-screen items-center justify-center px-4 py-6 sm:px-6">
        <div className="w-full max-w-sm rounded-[2rem] border border-white/16 bg-slate-950/32 p-8 shadow-[0_30px_80px_rgba(2,6,23,0.42)] backdrop-blur-xl">
          <div className="flex flex-col items-center gap-4 text-center text-white">
            <div className="relative flex h-20 w-20 items-center justify-center rounded-[2rem] border border-white/15 bg-white/10 shadow-lg shadow-slate-950/30">
              <Cross className="h-8 w-8 text-white" strokeWidth={2.2} />
            </div>
            <div className="space-y-1.5">
              <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-sky-100/70">
                Hospital Hanga Roa
              </p>
              <p className="text-sm font-medium text-white/92">Acceso seguro</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

const DefaultLoadingScreen = () => (
  <div
    data-testid="default-loading-screen"
    className="min-h-screen bg-slate-100 flex items-center justify-center"
  >
    <LoadingIndicator />
  </div>
);

interface InitialLoadingScreenProps {
  pathname?: string;
  preferLoginShell?: boolean;
}

export const InitialLoadingScreen: React.FC<InitialLoadingScreenProps> = ({
  pathname,
  preferLoginShell,
}) => {
  const variant = resolveInitialLoadingScreenVariant(pathname ?? resolveCurrentPathname(), {
    preferLoginShell,
  });

  if (variant === 'login-shell') {
    return <LoginShellLoadingScreen />;
  }

  return <DefaultLoadingScreen />;
};
