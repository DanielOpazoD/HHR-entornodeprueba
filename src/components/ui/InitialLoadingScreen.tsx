import React from 'react';
import { Loader2 } from 'lucide-react';
import { resolveInitialLoginBackgroundMode } from '@/shared/ui/loginBackgroundModeController';

import {
  LoginCardFrame,
  LoginAccessLoadingPlaceholder,
  LoginScreenLayout,
} from './LoginScreenLayout';

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

export const LoginShellLoadingScreen = () => {
  const backgroundMode = resolveInitialLoginBackgroundMode();
  return (
    <LoginScreenLayout mode={backgroundMode} testId="login-loading-shell">
      <LoginCardFrame>
        <LoginAccessLoadingPlaceholder />
      </LoginCardFrame>
    </LoginScreenLayout>
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
