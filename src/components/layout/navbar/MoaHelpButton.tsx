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
        className="flex h-8 min-w-8 items-center justify-center gap-1.5 rounded-lg border border-white/20 px-2 text-white/90 hover:bg-white/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
      >
        <CircleHelp size={16} aria-hidden="true" />
        <span className="hidden md:inline text-[13px] font-medium">Moa</span>
      </button>
      {isOpen && (
        <section
          id={panelId}
          aria-labelledby={titleId}
          tabIndex={-1}
          className="absolute inset-x-3 top-full z-50 mt-2 max-h-[calc(100vh-80px)] overflow-y-auto rounded-xl border border-slate-200 bg-white p-4 text-slate-700 shadow-xl sm:inset-x-auto sm:right-0 sm:w-80"
        >
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 id={titleId} className="text-base font-semibold text-slate-900">
                Moa · Ayuda de HHR
              </h2>
              <p className="mt-1 text-xs text-slate-600">Guía local, sin IA clínica.</p>
            </div>
            <button
              type="button"
              onClick={closeAndRestoreFocus}
              aria-label="Cerrar ayuda de Moa"
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg hover:bg-slate-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-slate-700"
            >
              <X size={16} aria-hidden="true" />
            </button>
          </div>
          <div className="mt-4 rounded-lg border border-sky-100 bg-sky-50 p-3">
            <p className="text-xs font-medium text-slate-600">En esta pantalla</p>
            <h3 className="mt-1 text-sm font-semibold text-slate-900">{context.title}</h3>
            <p className="mt-1 text-sm leading-relaxed">{context.description}</p>
          </div>
          <dl className="mt-4 space-y-3 text-sm leading-relaxed">
            <div>
              <dt className="font-semibold text-slate-900">Ubicación y fecha</dt>
              <dd>Antes de editar, comprueba el módulo y la fecha del registro seleccionado.</dd>
            </div>
            <div>
              <dt className="font-semibold text-slate-900">Herramientas</dt>
              <dd>Usa las opciones del módulo. Los accesos disponibles dependen de tu perfil.</dd>
            </div>
            <div>
              <dt className="font-semibold text-slate-900">Guardado y conexión</dt>
              <dd>
                Revisa los indicadores del programa. Tener conexión no confirma el guardado remoto.
              </dd>
            </div>
          </dl>
          <p className="mt-4 border-t border-slate-200 pt-3 text-xs leading-relaxed text-slate-600">
            Esta ayuda no consulta pacientes ni modifica registros. Las funciones habituales siguen
            disponibles fuera de Moa.
          </p>
        </section>
      )}
    </div>
  );
};
