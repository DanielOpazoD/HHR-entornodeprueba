import React from 'react';
import { Loader2 } from 'lucide-react';
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

      {/* Mirrors the real LoginPage layout (logo block, title block, access
          card) so an F5 on the login route hydrates in place instead of
          swapping layouts. Text is intentionally rendered as skeleton bars:
          duplicating the real copy here would create ambiguous matches for
          assistive tech and tests once the actual page mounts. */}
      <div
        aria-hidden="true"
        className="relative z-10 flex min-h-screen flex-col items-center justify-center px-4 py-6 sm:px-6"
      >
        <div className="mb-10 flex flex-col items-center text-center">
          <div className="relative inline-flex h-24 w-24 items-center justify-center rounded-2xl border border-white/20 bg-white/10 p-2 shadow-xl shadow-slate-950/30 backdrop-blur-2xl">
            <img
              src="/images/logos/logo_HHR.svg"
              alt=""
              className="h-full w-full object-contain drop-shadow-[0_2px_4px_rgba(2,6,23,0.35)]"
            />
          </div>
          <div className="mt-7 h-8 w-72 max-w-full animate-pulse rounded-lg bg-white/25" />
          <div className="mt-3 h-4 w-56 max-w-full animate-pulse rounded-md bg-white/15" />
        </div>

        <div className="w-full max-w-md rounded-[2rem] border border-white/16 bg-slate-950/32 p-8 shadow-[0_30px_80px_rgba(2,6,23,0.42)] backdrop-blur-xl">
          <div className="mx-auto h-7 w-48 max-w-full animate-pulse rounded-lg bg-white/25" />
          <div className="mt-7 h-14 w-full animate-pulse rounded-2xl border border-white/25 bg-white/25" />
          <div className="mt-4 flex justify-center">
            <div className="h-7 w-24 animate-pulse rounded-lg border border-white/15 bg-white/10" />
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
