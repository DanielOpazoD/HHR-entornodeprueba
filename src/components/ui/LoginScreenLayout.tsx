import React from 'react';
import { Eye, MoonStar, SunMedium } from 'lucide-react';
import {
  type LoginBackgroundMode,
  resolveLoginBackgroundImage,
} from '@/shared/ui/loginBackgroundModeController';

export const LOGIN_INPUT_CLASS =
  'mt-1.5 min-h-11 w-full rounded-xl border border-white/65 bg-white/95 px-3.5 py-2.5 text-base text-slate-900 shadow-sm outline-none transition focus:border-sky-300 focus:ring-2 focus:ring-sky-300/50 disabled:bg-white/95';
export const LOGIN_SUBMIT_CLASS =
  'min-h-11 w-full rounded-xl bg-sky-600 px-4 py-2.5 text-base font-semibold text-white shadow-sm transition hover:bg-sky-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-sky-300 disabled:cursor-wait disabled:opacity-70';

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
      className="relative min-h-screen overflow-hidden bg-slate-950"
    >
      <div
        data-testid="login-background-image"
        className="absolute inset-0 bg-contain bg-center bg-no-repeat"
        style={{ backgroundImage: `url('${image}')` }}
        aria-hidden="true"
      />
      <div
        className={`absolute inset-0 ${
          mode === 'day'
            ? 'bg-[linear-gradient(115deg,rgba(15,23,42,0.82)_0%,rgba(15,23,42,0.62)_36%,rgba(15,23,42,0.28)_64%,rgba(255,255,255,0.08)_100%)]'
            : 'bg-[linear-gradient(115deg,rgba(2,6,23,0.92)_0%,rgba(2,6,23,0.78)_35%,rgba(2,6,23,0.44)_66%,rgba(2,6,23,0.22)_100%)]'
        }`}
        aria-hidden="true"
      />
      <div
        className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(255,255,255,0.18),transparent_32%),radial-gradient(circle_at_bottom_right,rgba(14,165,233,0.14),transparent_26%)]"
        aria-hidden="true"
      />
      <button
        type="button"
        onClick={onToggleMode}
        disabled={!onToggleMode}
        className="absolute right-4 top-4 z-20 inline-flex items-center gap-2 rounded-full border border-white/20 bg-slate-950/25 px-3 py-2 text-xs font-medium text-white/90 backdrop-blur-md transition hover:bg-slate-950/40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white sm:right-6 sm:top-6"
        aria-label="Cambiar modo de fondo"
        title="Cambiar modo de fondo"
      >
        <ModeIcon className="h-3.5 w-3.5" />
        <span>{mode === 'day' ? 'Día' : 'Noche'}</span>
      </button>
      <main className="relative z-10 flex min-h-screen items-center justify-center px-4 py-6 sm:px-6">
        <div className="w-full max-w-sm">
          <header className="mb-5 text-center">
            <div className="inline-flex h-12 w-12 items-center justify-center rounded-2xl border border-white/20 bg-white/10 p-2 shadow-lg shadow-slate-950/20 backdrop-blur-md">
              <img
                src="/images/logos/logo_HHR.svg"
                alt="Hospital Hanga Roa"
                className="h-full w-full object-contain"
                width="32"
                height="32"
              />
            </div>
            <h1 className="mt-3 font-display text-2xl font-bold tracking-tight text-white drop-shadow-sm">
              Hospital Hanga Roa
            </h1>
            <p className="mt-1 text-xs text-white/85">Sistema Estadístico de Hospitalizados</p>
          </header>
          {children}
          <footer className="mt-4 text-center text-[10px] leading-relaxed text-white/75">
            <p>Rapa Nui, Chile</p>
            <p>Desarrollo: daniel.opazo@hospitalhangaroa.cl</p>
          </footer>
        </div>
      </main>
    </div>
  );
};

export const LoginCardFrame: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <section
    className="rounded-3xl border border-white/25 bg-slate-950/10 p-6 text-white shadow-[0_24px_64px_-24px_rgba(2,6,23,0.65)] backdrop-blur-md sm:p-7"
    aria-label="Acceso a HHR"
  >
    <h2 className="mb-5 text-xl font-semibold tracking-tight">Iniciar sesión</h2>
    {children}
  </section>
);

/** Inert fallback, never asks the user to type before the real form can accept input. */
export const LoginCredentialsPlaceholder = () => (
  <div className="space-y-3 text-sm text-white" aria-busy="true">
    <span role="status" className="sr-only">
      Cargando acceso al sistema…
    </span>
    <label className="block">
      Usuario
      <input className={LOGIN_INPUT_CLASS} placeholder="Ej. 111111111" disabled />
    </label>
    <p className="text-xs text-white/75">RUT con dígito verificador, sin puntos ni guion.</p>
    <label className="block">
      Contraseña
      <span className="relative block">
        <input
          className={`${LOGIN_INPUT_CLASS} pr-12`}
          type="password"
          autoComplete="off"
          disabled
        />
        <span
          className="absolute inset-y-0 right-0 flex w-11 items-center justify-center text-slate-600"
          aria-hidden="true"
        >
          <Eye size={18} />
        </span>
      </span>
    </label>
    <button type="button" className={LOGIN_SUBMIT_CLASS} disabled>
      Ingresar
    </button>
    <div className="flex justify-between text-xs">
      <button type="button" disabled className="underline underline-offset-4">
        Olvidé mi contraseña
      </button>
    </div>
    <div className="py-1 text-xs leading-relaxed text-white/75" aria-hidden="true">
      ▸ ¿Es tu primer ingreso?
    </div>
  </div>
);
