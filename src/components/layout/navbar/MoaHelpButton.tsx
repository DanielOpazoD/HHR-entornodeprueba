import React, { useId } from 'react';
import { CircleHelp, X } from 'lucide-react';
import type { ModuleType } from '@/constants/navigationConfig';
import { useNavbarDisclosure } from './useNavbarDisclosure';
import { getMoaHelpContext } from './moaHelpContent';

interface MoaHelpButtonProps {
  currentModule?: ModuleType;
}

/** B1: local help only. No patient context, storage, AI, or clinical actions. */
export const MoaHelpButton: React.FC<MoaHelpButtonProps> = ({ currentModule }) => {
  const {
    isOpen,
    menuRef,
    triggerRef,
    panelId,
    toggle,
    closeAndRestoreFocus,
    onKeyDown,
    onBlur,
  } = useNavbarDisclosure(currentModule);
  const titleId = useId();
  const context = getMoaHelpContext(currentModule);

  return (
    <div
      ref={menuRef}
      className="shrink-0 print:hidden sm:relative"
      onKeyDown={onKeyDown}
      onBlur={onBlur}
    >
      <button
        ref={triggerRef}
        type="button"
        onClick={toggle}
        aria-label="Ayuda de Moa"
        aria-expanded={isOpen}
        aria-controls={isOpen ? panelId : undefined}
        title="Ayuda de Moa"
        className="flex h-8 min-w-8 items-center justify-center gap-1.5 rounded-lg border border-white/20 px-2 text-white/90 transition-colors duration-150 hover:bg-white/10 aria-expanded:border-white/40 aria-expanded:bg-white/15 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white motion-reduce:transition-none"
      >
        <CircleHelp size={16} aria-hidden="true" />
        <span className="hidden md:inline text-[13px] font-medium">Moa</span>
      </button>
      {isOpen && (
        <section
          id={panelId}
          aria-labelledby={titleId}
          tabIndex={-1}
          className="absolute inset-x-3 top-full z-50 mt-2 max-h-[calc(100vh-80px)] overflow-y-auto overscroll-contain rounded-2xl border border-slate-200 bg-white text-slate-700 shadow-lg sm:inset-x-auto sm:right-0 sm:w-[360px]"
        >
          <div className="sticky top-0 z-10 flex items-start justify-between gap-3 border-b border-slate-100 bg-slate-50 p-4">
            <div className="flex min-w-0 items-center gap-3">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-sky-100 text-sky-800">
                <CircleHelp size={20} aria-hidden="true" />
              </div>
              <div className="min-w-0">
                <h2 id={titleId} className="text-sm font-semibold leading-5 text-slate-900">
                  Moa · Ayuda de HHR
                </h2>
                <p className="mt-1 text-xs leading-5 text-slate-600">Guía local, sin IA clínica.</p>
              </div>
            </div>
            <button
              type="button"
              onClick={closeAndRestoreFocus}
              aria-label="Cerrar ayuda de Moa"
              title="Cerrar ayuda (Esc)"
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-slate-600 transition-colors duration-150 hover:bg-slate-200 hover:text-slate-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-slate-700 motion-reduce:transition-none"
            >
              <X size={16} aria-hidden="true" />
            </button>
          </div>
          <div className="p-4">
            <div className="rounded-r-xl border-l-2 border-sky-600 bg-sky-50/60 p-3">
              <p className="text-xs font-medium text-sky-800">En esta pantalla</p>
              <h3 className="mt-1 text-base font-semibold text-slate-900">{context.title}</h3>
              <p className="mt-2 text-sm leading-5">{context.description}</p>
            </div>
            <dl className="mt-2 divide-y divide-slate-100 text-sm leading-5">
              <div className="py-3">
                <dt className="font-semibold text-slate-900">Ubicación y fecha</dt>
                <dd className="mt-1">Comprueba el módulo y la fecha antes de editar.</dd>
              </div>
              <div className="py-3">
                <dt className="font-semibold text-slate-900">Herramientas</dt>
                <dd className="mt-1">Los accesos disponibles dependen de tu perfil.</dd>
              </div>
              <div className="pt-3">
                <dt className="font-semibold text-slate-900">Guardado y conexión</dt>
                <dd className="mt-1">
                  Tener conexión no confirma el guardado remoto. Revisa los indicadores del programa.
                </dd>
              </div>
            </dl>
          </div>
          <p className="border-t border-slate-100 bg-slate-50 px-4 py-3 text-xs leading-5 text-slate-600">
            Esta ayuda no consulta pacientes ni modifica registros. Las herramientas habituales siguen
            disponibles fuera de Moa.
          </p>
        </section>
      )}
    </div>
  );
};
