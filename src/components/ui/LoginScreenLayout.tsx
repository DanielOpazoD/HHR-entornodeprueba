import React from 'react';
import { Eye, LockKeyhole, MoonStar, SunMedium } from 'lucide-react';
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
      className="relative min-h-screen overflow-hidden bg-[#f3efe6]"
    >
      <div
        data-testid="login-background-image"
        className="absolute inset-x-0 top-0 h-[15rem] bg-cover bg-[58%_center] bg-no-repeat sm:h-[18rem] lg:hidden"
        style={{ backgroundImage: `url('${image}')` }}
        aria-hidden="true"
      />
      <div
        className="absolute inset-x-0 top-0 h-[15rem] bg-[linear-gradient(180deg,rgba(6,24,27,0.45)_0%,rgba(6,24,27,0.12)_46%,rgba(243,239,230,0.98)_100%)] sm:h-[18rem] lg:hidden"
        aria-hidden="true"
      />
      <button
        type="button"
        onClick={onToggleMode}
        disabled={!onToggleMode}
        className="absolute right-4 top-4 z-30 inline-flex h-10 items-center gap-2 rounded-full border border-white/40 bg-[#071d20]/45 px-3.5 text-xs font-semibold text-white shadow-sm backdrop-blur-md transition hover:bg-[#071d20]/65 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-white disabled:cursor-default lg:right-7 lg:top-7"
        aria-label="Cambiar modo de fondo"
        title="Cambiar modo de fondo"
      >
        <ModeIcon className="h-4 w-4" aria-hidden="true" />
        <span>{mode === 'day' ? 'Día' : 'Noche'}</span>
      </button>

      <div className="relative z-10 grid min-h-screen lg:grid-cols-[minmax(28rem,46%)_minmax(0,54%)]">
        <section className="relative flex min-h-screen flex-col px-4 pb-4 pt-[14.25rem] sm:px-8 sm:pt-[17.25rem] lg:bg-[#f3efe6] lg:px-10 lg:py-8 xl:px-14 xl:py-10">
          <header className="absolute left-4 right-24 top-5 z-20 flex items-center justify-between sm:left-8 sm:right-36 sm:top-7 lg:static lg:right-auto lg:top-auto lg:z-auto lg:justify-start">
            <div className="hidden items-center gap-3 lg:flex">
              <div className="flex h-11 w-11 items-center justify-center rounded-xl border border-stone-300/80 bg-white/75 p-2 shadow-[0_8px_20px_-14px_rgba(15,23,42,0.5)]">
                <img
                  src="/images/logos/logo_HHR.svg"
                  alt="Hospital Hanga Roa"
                  className="h-full w-full object-contain"
                  width="32"
                  height="32"
                />
              </div>
              <div>
                <p className="font-display text-base font-semibold text-slate-950">
                  Hospital Hanga Roa
                </p>
                <p className="mt-0.5 text-xs text-stone-600">
                  Sistema Estadístico de Hospitalizados
                </p>
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
                <p className="hidden text-[11px] text-white/80 min-[360px]:block">
                  Sistema Estadístico de Hospitalizados
                </p>
              </div>
            </div>
          </header>

          <main className="mx-auto flex w-full max-w-[29rem] flex-1 flex-col justify-center py-5 lg:mx-0 lg:max-w-[27rem] lg:py-8 xl:max-w-[29rem]">
            <div className="mb-5 sm:mb-6">
              <p className="flex items-center gap-2 text-[11px] font-semibold uppercase text-teal-800">
                <LockKeyhole className="h-3.5 w-3.5" aria-hidden="true" />
                Acceso institucional
              </p>
              <h1 className="mt-2 font-display text-[2.15rem] font-semibold leading-[1.08] text-slate-950 sm:text-[2.35rem]">
                Iniciar sesión
              </h1>
              <p className="mt-2 max-w-sm text-sm leading-6 text-stone-600">
                Ingresa con tu RUT o cuenta institucional para continuar.
              </p>
            </div>
            {children}
          </main>

          <footer className="login-support-footer mx-auto w-full max-w-[29rem] border-t border-stone-300/80 pt-3 text-[11px] leading-5 text-stone-600 lg:mx-0 lg:max-w-[27rem] xl:max-w-[29rem]">
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
          className="relative hidden min-h-screen overflow-hidden lg:block"
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
          <div className="absolute inset-x-0 bottom-0 px-10 pb-9 text-white xl:px-14 xl:pb-12">
            <div className="max-w-md border-l border-white/45 pl-5">
              <p className="text-[11px] font-semibold uppercase text-white/75">
                Hospital Hanga Roa
              </p>
              <p className="mt-2 font-display text-2xl font-medium leading-tight">
                Información clínica disponible cuando la necesitas.
              </p>
            </div>
          </div>
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

/** Inert fallback, never asks the user to type before the real form can accept input. */
export const LoginCredentialsPlaceholder = () => (
  <div className="space-y-4" aria-busy="true">
    <span role="status" className="sr-only">
      Cargando acceso al sistema…
    </span>
    <label className="block text-sm font-medium text-slate-800">
      Usuario
      <input className={LOGIN_INPUT_CLASS} placeholder="Ej. 111111111" disabled />
    </label>
    <p className="mt-1! text-xs text-stone-600">RUT con dígito verificador, sin puntos ni guion.</p>
    <label className="block text-sm font-medium text-slate-800">
      Contraseña
      <span className="relative block">
        <input
          className={`${LOGIN_INPUT_CLASS} pr-12`}
          type="password"
          autoComplete="off"
          disabled
        />
        <span
          className="absolute inset-y-0 right-0 flex w-11 items-center justify-center text-stone-500"
          aria-hidden="true"
        >
          <Eye size={18} />
        </span>
      </span>
    </label>
    <button type="button" className={LOGIN_SUBMIT_CLASS} disabled>
      Ingresar
    </button>
    <div className="flex justify-between text-xs text-stone-600">
      <button type="button" disabled className="underline underline-offset-4">
        Olvidé mi contraseña
      </button>
    </div>
    <div
      className="border-t border-stone-200 pt-3 text-xs leading-relaxed text-stone-600"
      aria-hidden="true"
    >
      ¿Es tu primer ingreso?
    </div>
  </div>
);
