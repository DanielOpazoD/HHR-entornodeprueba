import React from 'react';
import { Loader2, MoonStar, SunMedium } from 'lucide-react';
import {
  type LoginBackgroundMode,
  resolveLoginBackgroundImage,
} from '@/shared/ui/loginBackgroundModeController';

export const LOGIN_INPUT_CLASS =
  'mt-1.5 min-h-11 w-full rounded-xl border border-stone-300 bg-white px-3.5 py-2.5 text-base text-slate-950 shadow-[0_1px_2px_rgba(15,23,42,0.04)] outline-none transition placeholder:text-stone-600 hover:border-stone-400 focus:border-teal-700 focus:ring-4 focus:ring-teal-700/10 disabled:cursor-not-allowed disabled:bg-stone-100 disabled:text-stone-500';
export const LOGIN_SUBMIT_CLASS =
  'min-h-11 w-full rounded-xl bg-[#173e3a] px-4 py-2.5 text-base font-semibold text-white shadow-[0_10px_24px_-12px_rgba(23,62,58,0.7)] transition hover:-translate-y-px hover:bg-[#0f514b] active:translate-y-0 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-teal-700 disabled:cursor-wait disabled:translate-y-0 disabled:opacity-60';

interface LoginScreenLayoutProps {
  mode: LoginBackgroundMode;
  children: React.ReactNode;
  onToggleMode?: () => void;
  testId: string;
  authState?: string;
}

/** Shared, auth-free presentation: startup and the ready form keep the same geometry. */
export const LoginScreenLayout: React.FC<LoginScreenLayoutProps> = ({
  mode,
  children,
  onToggleMode,
  testId,
  authState,
}) => {
  const image = resolveLoginBackgroundImage(mode);
  const ModeIcon = mode === 'day' ? SunMedium : MoonStar;
  return (
    <div
      data-testid={testId}
      data-auth-state={authState}
      data-background-mode={mode}
      data-background-image={image}
      className="relative min-h-dvh overflow-x-clip bg-[#f3efe6]"
    >
      <div
        data-testid="login-background-image"
        className="absolute inset-x-0 top-0 h-36 bg-cover bg-[58%_center] bg-no-repeat lg:hidden"
        style={{ backgroundImage: `url('${image}')` }}
        aria-hidden="true"
      />
      <div
        className="absolute inset-x-0 top-0 h-36 bg-[linear-gradient(180deg,rgba(6,24,27,0.45)_0%,rgba(6,24,27,0.12)_46%,rgba(243,239,230,0.98)_100%)] lg:hidden"
        aria-hidden="true"
      />
      <button
        type="button"
        onClick={onToggleMode}
        disabled={!onToggleMode}
        className="absolute right-4 top-4 z-30 inline-flex h-9 items-center gap-2 rounded-full border border-white/40 bg-[#071d20]/45 px-3 text-xs font-semibold text-white shadow-sm backdrop-blur-md transition hover:bg-[#071d20]/65 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-white disabled:cursor-default lg:right-6 lg:top-6"
        aria-label="Cambiar modo de fondo"
        title="Cambiar modo de fondo"
      >
        <ModeIcon className="h-4 w-4" aria-hidden="true" />
        <span className="hidden min-[400px]:inline">{mode === 'day' ? 'Día' : 'Noche'}</span>
      </button>

      <div className="relative z-10 grid min-h-dvh lg:grid-cols-[minmax(20rem,25rem)_minmax(0,1fr)]">
        <section className="relative flex min-h-dvh flex-col px-5 pb-4 pt-24 sm:px-8 lg:bg-[#f3efe6] lg:px-8 lg:py-6">
          <header className="absolute left-5 right-20 top-4 z-20 flex items-center justify-between sm:left-8 lg:static lg:right-auto lg:top-auto lg:z-auto lg:justify-start">
            <div className="hidden items-center gap-3 lg:flex">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-stone-300/80 bg-white/75 p-2 shadow-[0_8px_20px_-14px_rgba(15,23,42,0.5)]">
                <img
                  src="/images/logos/logo_HHR.svg"
                  alt="Hospital Hanga Roa"
                  className="h-full w-full object-contain"
                  width="32"
                  height="32"
                />
              </div>
              <div>
                <p className="font-display text-[15px] font-semibold text-slate-950">
                  Hospital Hanga Roa
                </p>
                <p className="mt-0.5 text-[11px] text-stone-600">Servicio de Hospitalizados</p>
              </div>
            </div>
            <div className="flex items-center gap-2.5 text-white drop-shadow-[0_1px_3px_rgba(4,20,24,0.8)] lg:hidden">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-white/45 bg-[#071d20]/35 p-2 backdrop-blur-md">
                <img
                  src="/images/logos/logo_HHR.svg"
                  alt=""
                  className="h-full w-full object-contain"
                  width="32"
                  height="32"
                />
              </div>
              <div>
                <p className="font-display text-sm font-semibold">Hospital Hanga Roa</p>
                <p className="text-[11px] text-white/80">Servicio de Hospitalizados</p>
              </div>
            </div>
          </header>

          <main className="mx-auto flex w-full max-w-[21rem] flex-1 flex-col justify-center py-3 lg:mx-0">
            <div className="mb-4">
              <h1 className="font-display text-[1.85rem] font-semibold leading-tight text-slate-950">
                Iniciar sesión
              </h1>
            </div>
            {children}
          </main>

          <footer className="login-support-footer mx-auto w-full max-w-[21rem] border-t border-stone-300/80 pt-2 text-[11px] leading-4 text-stone-600 lg:mx-0">
            <p>
              <span className="font-medium text-stone-700">
                Hospital Hanga Roa · Rapa Nui, Chile
              </span>
              <span className="mx-1.5 text-stone-400" aria-hidden="true">
                ·
              </span>
              Soporte:{' '}
              <a
                href="mailto:daniel.opazo@hospitalhangaroa.cl"
                className="text-teal-800 underline decoration-teal-800/35 underline-offset-4 transition hover:text-teal-950 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-700"
              >
                daniel.opazo@hospitalhangaroa.cl
              </a>
            </p>
          </footer>
        </section>

        <aside
          className="relative hidden min-h-dvh overflow-hidden lg:block"
          aria-label="Hospital Hanga Roa"
        >
          <div
            className="absolute inset-0 bg-cover bg-center bg-no-repeat"
            style={{ backgroundImage: `url('${image}')` }}
            aria-hidden="true"
          />
          <div
            className="absolute inset-0 bg-[linear-gradient(180deg,rgba(4,20,24,0.08)_0%,rgba(4,20,24,0.12)_56%,rgba(4,20,24,0.72)_100%)]"
            aria-hidden="true"
          />
        </aside>
      </div>
    </div>
  );
};

export const LoginCardFrame: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <section aria-label="Acceso a HHR" className="text-slate-950">
    {children}
  </section>
);

export const LoginAccessPending = ({
  title = 'Validando tu acceso…',
  hint = 'Comprobando tu acceso. Un momento, por favor.',
}: {
  title?: string;
  hint?: string;
}) => (
  <div
    role="status"
    aria-live="polite"
    aria-atomic="true"
    className="flex h-full flex-col items-center justify-center gap-4 rounded-xl border border-teal-200 bg-white/95 px-5 text-center shadow-sm backdrop-blur-sm"
  >
    <span className="flex h-12 w-12 items-center justify-center rounded-full bg-teal-800/10 text-teal-800">
      <Loader2 className="h-6 w-6 motion-safe:animate-spin" aria-hidden="true" />
    </span>
    <div>
      <p className="text-base font-semibold text-teal-950">{title}</p>
      <p className="mt-1 text-xs leading-5 text-teal-900">{hint}</p>
    </div>
  </div>
);

/** Startup and the accepted-login transition share the active progress panel. */
export const LoginAccessLoadingPlaceholder = () => (
  <div className="space-y-4" aria-busy="true">
    <div className="h-64">
      <LoginAccessPending />
    </div>
    <div
      className="flex items-start gap-4 border-t border-stone-200 pt-3 text-xs text-stone-600"
      aria-hidden="true"
    >
      <div className="h-11 w-11 shrink-0 rounded-full border border-stone-300 bg-white" />
      <div className="flex min-h-11 flex-1 items-center justify-end gap-3 font-medium text-stone-700">
        <span>Ayuda de acceso</span>
        <span className="text-base">+</span>
      </div>
    </div>
  </div>
);
