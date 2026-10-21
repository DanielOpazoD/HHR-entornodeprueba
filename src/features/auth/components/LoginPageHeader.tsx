import React from 'react';

interface LoginPageHeaderProps {
  isDayGradient: boolean;
}

export const LoginPageHeader: React.FC<LoginPageHeaderProps> = ({ isDayGradient }) => {
  // Match the login card's frosted-glass aesthetic so the logo container
  // belongs to the same visual layer instead of reading as a sticker.
  // The SVG logo is opaque enough to stay legible over any background.
  const glassFrameClass = isDayGradient
    ? 'bg-white/10 border-white/25 ring-1 ring-inset ring-white/10'
    : 'bg-slate-950/15 border-white/15 ring-1 ring-inset ring-white/5';

  return (
    <div className="mb-5 text-center animate-login-reveal animate-login-reveal-delay-1">
      <div
        className={`relative inline-flex items-center justify-center h-14 w-14 rounded-2xl border p-2 shadow-xl shadow-slate-950/30 backdrop-blur-2xl backdrop-saturate-150 ${glassFrameClass}`}
      >
        {/* Top-edge inner highlight: simulates glass refraction at the lit edge */}
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-2 top-0 h-px bg-gradient-to-r from-transparent via-white/45 to-transparent"
        />
        <div className="flex h-full w-full items-center justify-center rounded-xl">
          <img
            src="/images/logos/logo_HHR.svg"
            alt="Hospital Hanga Roa"
            className="h-full w-full object-contain drop-shadow-[0_2px_4px_rgba(2,6,23,0.35)]"
          />
        </div>
      </div>
      <h1 className="mt-3 font-display text-2xl font-bold tracking-tight text-white drop-shadow-[0_2px_4px_rgba(2,6,23,0.55)] sm:text-2xl">
        Hospital Hanga Roa
      </h1>
      <p className={`mt-1 text-xs ${isDayGradient ? 'text-white/86' : 'text-sky-100/82'}`}>
        Sistema Estadístico de Hospitalizados
      </p>
    </div>
  );
};
