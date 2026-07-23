import React from 'react';
import { KeyRound, Loader2, RefreshCw } from 'lucide-react';
import type { SyslabAccessModel } from '../hooks/useSyslabAccess';

interface SyslabAccessPromptProps {
  access: SyslabAccessModel;
}

export const SyslabAccessPrompt: React.FC<SyslabAccessPromptProps> = ({ access }) => {
  if (access.state !== 'login-required') return null;

  return (
    <section
      className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-amber-950"
      aria-labelledby="syslab-access-title"
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white text-amber-700 shadow-sm">
            <KeyRound size={17} />
          </span>
          <div>
            <h3 id="syslab-access-title" className="text-[13px] font-semibold">
              Syslab requiere iniciar sesión
            </h3>
            <p className="mt-0.5 text-[11px] leading-relaxed text-amber-800">
              {access.message} Las credenciales se ingresan en una ventana segura de la extensión y
              no se guardan en HHR.
            </p>
          </div>
        </div>
        <div className="flex shrink-0 gap-2">
          {access.isAwaitingLogin ? (
            <button
              type="button"
              onClick={() => void access.refresh()}
              className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-amber-300 bg-white px-3 py-2 text-[11px] font-semibold text-amber-800 hover:bg-amber-100"
            >
              <RefreshCw size={14} />
              Comprobar ahora
            </button>
          ) : (
            <button
              type="button"
              onClick={() => void access.openLogin()}
              disabled={access.isOpening}
              className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-amber-700 px-3 py-2 text-[11px] font-semibold text-white shadow-sm hover:bg-amber-800 disabled:cursor-wait disabled:opacity-60"
            >
              {access.isOpening ? (
                <Loader2 size={14} className="animate-spin" />
              ) : (
                <KeyRound size={14} />
              )}
              {access.isOpening ? 'Abriendo…' : 'Iniciar sesión en Syslab'}
            </button>
          )}
        </div>
      </div>
    </section>
  );
};
